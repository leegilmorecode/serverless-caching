import * as apigw from "@aws-cdk/aws-apigateway";
import * as cdk from "@aws-cdk/core";
import * as customResources from "@aws-cdk/custom-resources";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as iam from "@aws-cdk/aws-iam";
import * as lambda from "@aws-cdk/aws-lambda";
import * as nodeLambda from "@aws-cdk/aws-lambda-nodejs";
import * as path from "path";
import * as rds from "@aws-cdk/aws-rds";
import * as s3 from "@aws-cdk/aws-s3";
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";

import { config } from "./config";

export class AwsBlogStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // create the vpc for the database to sit in
    const vpc: ec2.Vpc = new ec2.Vpc(this, "aws-blog-vpc", {
      cidr: "10.0.0.0/16",
      natGateways: 0,
      maxAzs: 3,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "private-subnet-1",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // provision serverless aurora in our vpc with the data api enabled
    const cluster: rds.ServerlessCluster = new rds.ServerlessCluster(
      this,
      "blogs-serverless-db",
      {
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
        engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
        enableDataApi: true, // Optional - will be automatically set if you call grantDataApiAccess()
        backupRetention: cdk.Duration.days(1),
        clusterIdentifier: "blogs-serverless-db",
        defaultDatabaseName: config.database,
        deletionProtection: false,
        scaling: {
          autoPause: cdk.Duration.minutes(10), // default is to pause after 5 minutes of idle time
          minCapacity: rds.AuroraCapacityUnit.ACU_1, // default is 2 Aurora capacity units (ACUs)
          maxCapacity: rds.AuroraCapacityUnit.ACU_1, // default is 16 Aurora capacity units (ACUs)
        },
        credentials: {
          username: "admin",
          password: cdk.SecretValue.plainText(config.databasePassword),
          usernameAsString: true,
          secretName: "blogsdbSecret",
        },
      }
    );

    cluster.node.addDependency(vpc);

    // generate a secrets manager secret for accessing the database
    const secret = new secretsmanager.Secret(this, "blogs-db-secrets", {
      description: "blogs-db-secrets",
      secretName: "blogs-db-secrets",
      generateSecretString: {
        generateStringKey: "blogs-db-secrets",
        secretStringTemplate: JSON.stringify({
          username: config.databaseUserName,
          password: config.databasePassword,
          engine: "mysql",
          host: cluster.clusterEndpoint.hostname,
          port: 3306,
          dbClusterIdentifier: cluster.clusterIdentifier,
        }),
      },
    });

    secret.node.addDependency(cluster);

    // create an s3 bucket for the logo files
    const logoBucket: s3.Bucket = new s3.Bucket(
      this,
      "company-logo-bucket-caching",
      {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        bucketName: "company-logo-bucket-caching",
      }
    );

    // list blogs endpoint handler
    const listBlogsHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "list-blogs", {
        functionName: "list-blogs",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/blogs/list-blogs/list-blogs.ts"),
        memorySize: 1024,
        handler: "listBlogsHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          REGION: cdk.Stack.of(this).region,
          CLUSTER_ARN: cluster.clusterArn,
          HOSTNAME: cluster.clusterEndpoint.hostname,
          DB: config.database,
          SECRET_ARN: secret.secretFullArn as string,
        },
      });

    // create-blogs-table handler
    const createBlogsTableHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "create-blogs-table", {
        functionName: "create-blogs-table",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/blogs/create-blogs-table/create-blogs-table.ts"
        ),
        memorySize: 1024,
        handler: "createBlogsTableHandler",
        timeout: cdk.Duration.minutes(15),
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          REGION: cdk.Stack.of(this).region,
          CLUSTER_ARN: cluster.clusterArn,
          HOSTNAME: cluster.clusterEndpoint.hostname,
          DB: config.database,
          SECRET_ARN: secret.secretFullArn as string,
        },
      });

    const getBlogHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "get-blog", {
        functionName: "get-blog",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/blogs/get-blog/get-blog.ts"),
        memorySize: 1024,
        handler: "getBlogHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          REGION: cdk.Stack.of(this).region,
          CLUSTER_ARN: cluster.clusterArn,
          HOSTNAME: cluster.clusterEndpoint.hostname,
          DB: config.database,
          SECRET_ARN: secret.secretFullArn as string,
        },
      });

    // list blogs (cached in memory) endpoint handler
    const listBlogsCachedInMemoryHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "list-blogs-cached-in-memory", {
        functionName: "list-blogs-cached-in-memory",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/blogs/list-blogs-cache-in-memory/list-blogs-cache-in-memory.ts"
        ),
        memorySize: 1024,
        handler: "listBlogsCachedInMemoryHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          REGION: cdk.Stack.of(this).region,
          CLUSTER_ARN: cluster.clusterArn,
          HOSTNAME: cluster.clusterEndpoint.hostname,
          DB: config.database,
          SECRET_ARN: secret.secretFullArn as string,
        },
      });

    // list logos (cached in tmp) endpoint handler
    const listLogosCachedInTmpHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "list-logos-cached-in-tmp", {
        functionName: "list-logos-cached-in-tmp",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/blogs/list-blogs-cache-in-tmp/list-blogs-cache-in-tmp.ts"
        ),
        memorySize: 1024,
        handler: "listLogosCachedInTmpHandler",
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          REGION: cdk.Stack.of(this).region,
          BUCKET: logoBucket.bucketName,
        },
      });

    // create a policy statement
    const s3ListBucketsPolicy: iam.PolicyStatement = new iam.PolicyStatement({
      actions: ["s3:*"],
      resources: ["arn:aws:s3:::*"],
    });

    // add the policy to the functions role
    listLogosCachedInTmpHandler.role?.attachInlinePolicy(
      new iam.Policy(this, "list-buckets-policy", {
        statements: [s3ListBucketsPolicy],
      })
    );

    // grant read access to our secret from our lambdas
    secret.grantRead(createBlogsTableHandler.role as iam.IRole);
    secret.grantRead(getBlogHandler.role as iam.IRole);
    secret.grantRead(listBlogsHandler.role as iam.IRole);
    secret.grantRead(listBlogsCachedInMemoryHandler.role as iam.IRole);

    // create the rest API for accessing our lambdas
    const api: apigw.RestApi = new apigw.RestApi(this, "blogs-api", {
      description: "blogs api gateway",
      deploy: true,
      deployOptions: {
        // this enables caching on our api gateway, with a ttl of five minutes (unless overridden per method)
        cachingEnabled: true,
        cacheClusterEnabled: true,
        cacheDataEncrypted: true,
        stageName: "prod",
        dataTraceEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        cacheTtl: cdk.Duration.minutes(5),
        throttlingBurstLimit: 100,
        throttlingRateLimit: 100,
        tracingEnabled: true,
        metricsEnabled: true,
        // Method deployment options for specific resources/methods. (override common options defined in `StageOptions#methodOptions`)
        methodOptions: {
          "/blogs/GET": {
            throttlingRateLimit: 10,
            throttlingBurstLimit: 10,
            cacheDataEncrypted: true,
            cachingEnabled: true,
            cacheTtl: cdk.Duration.minutes(10),
            loggingLevel: apigw.MethodLoggingLevel.INFO,
            dataTraceEnabled: true,
            metricsEnabled: true,
          },
          "/blogs/{id}/GET": {
            throttlingRateLimit: 20,
            throttlingBurstLimit: 20,
            cachingEnabled: true,
            cacheDataEncrypted: true,
            cacheTtl: cdk.Duration.minutes(1),
            loggingLevel: apigw.MethodLoggingLevel.INFO,
            dataTraceEnabled: true,
            metricsEnabled: true,
          },
          // blogs cached in memory so we want to turn off api gateway caching
          "/blogs-cached-in-memory/GET": {
            throttlingRateLimit: 10,
            throttlingBurstLimit: 10,
            cacheDataEncrypted: true,
            cachingEnabled: false,
            cacheTtl: cdk.Duration.minutes(0),
            loggingLevel: apigw.MethodLoggingLevel.INFO,
            dataTraceEnabled: true,
            metricsEnabled: true,
          },
          // logos cached in tmp so we want to turn off api gateway caching
          "/logos-cached-in-tmp/GET": {
            throttlingRateLimit: 10,
            throttlingBurstLimit: 10,
            cacheDataEncrypted: true,
            cachingEnabled: false,
            cacheTtl: cdk.Duration.minutes(0),
            loggingLevel: apigw.MethodLoggingLevel.INFO,
            dataTraceEnabled: true,
            metricsEnabled: true,
          },
        },
      },
      defaultCorsPreflightOptions: {
        allowHeaders: ["Content-Type", "X-Amz-Date"],
        allowMethods: ["GET"],
        allowCredentials: true,
        allowOrigins: apigw.Cors.ALL_ORIGINS, // we wouldn't do this in production
      },
    });

    // add a /blogs resource
    const blogs: apigw.Resource = api.root.addResource("blogs");

    // add a /blogs-cached-in-memory resource
    const blogsCachedInMemory: apigw.Resource = api.root.addResource(
      "blogs-cached-in-memory"
    );

    // add a /logos-cached-in-tmp resource
    const logosCachedInTmp: apigw.Resource = api.root.addResource(
      "logos-cached-in-tmp"
    );

    // integrate the lambda to the method - GET /blogs
    blogs.addMethod(
      "GET",
      new apigw.LambdaIntegration(listBlogsHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );

    // integrate the lambda to the method - GET /blogs-cached-in-memory
    blogsCachedInMemory.addMethod(
      "GET",
      new apigw.LambdaIntegration(listBlogsCachedInMemoryHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );

    // integrate the lambda to the method - GET /logos-cached-in-tmp
    logosCachedInTmp.addMethod(
      "GET",
      new apigw.LambdaIntegration(listLogosCachedInTmpHandler, {
        proxy: true,
        allowTestInvoke: true,
      })
    );

    // integrate the lambda to the method - GET /blog/{id}
    const blog: apigw.Resource = blogs.addResource("{id}");
    blog.addMethod(
      "GET",
      new apigw.LambdaIntegration(getBlogHandler, {
        proxy: true,
        allowTestInvoke: true,
        // ensure that our caching is done on the id path parameter
        cacheKeyParameters: ["method.request.path.id"],
        cacheNamespace: "blogId",
        requestParameters: {
          "integration.request.path.id": "method.request.path.id",
        },
      }),
      {
        requestParameters: {
          "method.request.path.id": true,
        },
      }
    );

    // add the permissions to the funtions to use the data api
    cluster.grantDataApiAccess(createBlogsTableHandler);
    cluster.grantDataApiAccess(getBlogHandler);
    cluster.grantDataApiAccess(listBlogsHandler);
    cluster.grantDataApiAccess(listBlogsCachedInMemoryHandler);

    // add a custom sdk call to invoke our create table lambda (this will create the table and dummy data on deploy)
    const lambdaInvokeSdkCall: customResources.AwsSdkCall = {
      service: "Lambda",
      action: "invoke",
      parameters: {
        FunctionName: "create-blogs-table",
        Payload: `{"path": "${path}"}`,
      },
      physicalResourceId: customResources.PhysicalResourceId.of("BlogsTable"),
    };

    // custom resource function role for our custom resource
    const customResourceFnRole: iam.Role = new iam.Role(
      this,
      "custom-resource-role",
      {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      }
    );

    // allow the custom role to invoke our create blogs table lambda
    customResourceFnRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          `arn:aws:lambda:${cdk.Stack.of(this).region}:${
            cdk.Stack.of(this).account
          }:function:create-blogs-table`,
        ],
        actions: ["lambda:InvokeFunction"],
      })
    );

    // run a custom resource lambda on deploy to create the table and dummy data to play with
    const customResource: customResources.AwsCustomResource =
      new customResources.AwsCustomResource(
        this,
        "create-blog-table-custom-resource",
        {
          policy: customResources.AwsCustomResourcePolicy.fromSdkCalls({
            resources: customResources.AwsCustomResourcePolicy.ANY_RESOURCE,
          }),
          functionName: "invoke-create-table-lambda",
          onCreate: lambdaInvokeSdkCall,
          onUpdate: lambdaInvokeSdkCall,
          timeout: cdk.Duration.minutes(15),
          role: customResourceFnRole,
        }
      );

    customResource.node.addDependency(cluster);
    customResource.node.addDependency(createBlogsTableHandler);

    // add some outputs to use later
    new cdk.CfnOutput(this, "BlogsEndpointUrl", {
      value: `${api.url}blogs`,
      exportName: "BlogsEndpointUrl",
    });

    new cdk.CfnOutput(this, "BlogsdbEndpoint", {
      value: cluster.clusterEndpoint.hostname,
      exportName: "BlogsdbEndpoint",
    });

    new cdk.CfnOutput(this, "BlogsdbSecret", {
      value: secret.secretFullArn || "",
      exportName: "BlogsdbSecret",
    });

    new cdk.CfnOutput(this, "BlogsdbHostname", {
      value: cluster.clusterEndpoint.hostname,
      exportName: "BlogsdbHostname",
    });
  }
}
