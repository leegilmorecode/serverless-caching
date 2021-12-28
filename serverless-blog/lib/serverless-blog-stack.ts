import * as appsync from "@aws-cdk/aws-appsync";
import * as cdk from "@aws-cdk/core";
import * as customResources from "@aws-cdk/custom-resources";
import * as dynamodb from "@aws-cdk/aws-dynamodb";
import * as dynamodbDax from "@aws-cdk/aws-dax";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as iam from "@aws-cdk/aws-iam";
import * as lambda from "@aws-cdk/aws-lambda";
import * as nodeLambda from "@aws-cdk/aws-lambda-nodejs";
import * as path from "path";

export class ServerlessBlogStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dynamoDBTableName = "BlogTable";

    // create the vpc for dax to sit in
    const vpc: ec2.Vpc = new ec2.Vpc(this, "serverless-blog-vpc", {
      cidr: "10.0.0.0/16",
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "private-subnet-1",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // create the appsync api
    const api = new appsync.GraphqlApi(this, "Api", {
      name: "serverless-blog-api",
      schema: appsync.Schema.fromAsset(
        path.join(__dirname, "../src/schema.graphql")
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY, // we will use api key for the demo
        },
      },
      xrayEnabled: true,
      logConfig: {
        excludeVerboseContent: false,
        fieldLogLevel: appsync.FieldLogLevel.NONE,
      },
    });

    // create the dynamodb table
    const blogTable = new dynamodb.Table(this, dynamoDBTableName, {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: false,
      tableName: dynamoDBTableName,
      contributorInsightsEnabled: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: "id",
        type: dynamodb.AttributeType.STRING,
      },
    });

    // create a role for dax
    const daxServiceRole: iam.Role = new iam.Role(this, "dax-service-role", {
      assumedBy: new iam.ServicePrincipal("dax.amazonaws.com"),
    });

    // create a subnet group for our dax cluster to utilise
    const subnetGroup: dynamodbDax.CfnSubnetGroup =
      new dynamodbDax.CfnSubnetGroup(this, "dax-subnet-group", {
        subnetIds: vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }).subnetIds,
        subnetGroupName: "dax-subnet-group",
        description: "subnet group for our dax cluster",
      });

    // add a security group for the lambdas
    const lambdaSecurityGroup: ec2.SecurityGroup = new ec2.SecurityGroup(
      this,
      "lambda-vpc-sg",
      {
        vpc,
        allowAllOutbound: true,
        securityGroupName: "lambda-vpc-sg",
      }
    );

    // add a security group for the dax cluster
    const daxSecurityGroup: ec2.SecurityGroup = new ec2.SecurityGroup(
      this,
      "dax-vpc-sg",
      {
        vpc,
        allowAllOutbound: true,
        securityGroupName: "dax-vpc-sg",
      }
    );

    // allow inbound traffic from the lambda security group on port 8111
    daxSecurityGroup.addIngressRule(lambdaSecurityGroup, ec2.Port.tcp(8111));

    // create the dynamodb dax cluster
    const blogsDaxCluster = new dynamodbDax.CfnCluster(
      this,
      "blogsDaxCluster",
      {
        iamRoleArn: daxServiceRole.roleArn,
        nodeType: "dax.t2.small",
        replicationFactor: 2,
        securityGroupIds: [daxSecurityGroup.securityGroupId],
        subnetGroupName: subnetGroup.subnetGroupName,
        availabilityZones: vpc.availabilityZones,
        clusterEndpointEncryptionType: "NONE",
        clusterName: "blogsDaxCluster",
        description: "blogs dax cluster",
        preferredMaintenanceWindow: "sun:01:00-sun:09:00",
        sseSpecification: {
          sseEnabled: false,
        },
      }
    );

    // add permissions to the dax policy
    daxServiceRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:DescribeTable",
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
        ],
        resources: [blogTable.tableArn],
      })
    );

    blogsDaxCluster.node.addDependency(vpc);
    subnetGroup.node.addDependency(vpc);
    blogsDaxCluster.node.addDependency(subnetGroup);

    // get blog endpoint handler - this uses dax for its caching
    const getBlogHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "get-blog", {
        functionName: "get-blog",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/blogs/get-blog/get-blog.ts"),
        memorySize: 1024,
        securityGroups: [lambdaSecurityGroup],
        handler: "getBlogHandler",
        timeout: cdk.Duration.seconds(30),
        vpc,
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          REGION: cdk.Stack.of(this).region,
          TABLE_NAME: blogTable.tableName,
          DAX_ENDPOINT: blogsDaxCluster.attrClusterDiscoveryEndpoint,
        },
      });

    // list blogs endpoint handler - this uses dax for its caching
    const listBlogsHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "list-blogs", {
        functionName: "get-blogs",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(__dirname, "/../src/blogs/list-blogs/list-blogs.ts"),
        memorySize: 1024,
        securityGroups: [lambdaSecurityGroup],
        timeout: cdk.Duration.seconds(30),
        handler: "listBlogsHandler",
        vpc,
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          REGION: cdk.Stack.of(this).region,
          TABLE_NAME: blogTable.tableName,
          DAX_ENDPOINT: blogsDaxCluster.attrClusterDiscoveryEndpoint,
        },
      });

    // create-blogs-table handler - this will populate the table with fake data
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
          TABLE_NAME: blogTable.tableName,
        },
      });

    // get blog no dax endpoint handler - this does not use dax for its caching
    const getBlogNoDaxHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, "get-blog-no-dax", {
        functionName: "get-blog-no-dax",
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: path.join(
          __dirname,
          "/../src/blogs/get-blog-no-dax/get-blog-no-dax.ts"
        ),
        memorySize: 1024,
        securityGroups: [lambdaSecurityGroup],
        handler: "getBlogNoDaxHandler",
        timeout: cdk.Duration.seconds(30),
        bundling: {
          minify: true,
          externalModules: ["aws-sdk"],
        },
        environment: {
          REGION: cdk.Stack.of(this).region,
          TABLE_NAME: blogTable.tableName,
        },
      });

    // give the create blogs table lambda write access to the database
    blogTable.grantWriteData(createBlogsTableHandler);

    // give the lambdas access to the DAX cluster
    getBlogHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dax:GetItem"],
        resources: [blogsDaxCluster.attrArn],
      })
    );

    listBlogsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dax:Scan"],
        resources: [blogsDaxCluster.attrArn],
      })
    );

    // give the lambda access to dynamodb
    getBlogNoDaxHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:GetItem"],
        resources: [blogTable.tableArn],
      })
    );

    // list blogs lambda data source
    const blogsDataSource: appsync.LambdaDataSource =
      new appsync.LambdaDataSource(this, "ListBlogsLambdaDataSource", {
        api,
        lambdaFunction: listBlogsHandler,
        description: "List Blogs Lambda Data Source",
        name: "ListBlogsLambdaDataSource",
      });

    // get blog lambda data source
    const blogDataSource: appsync.LambdaDataSource =
      new appsync.LambdaDataSource(this, "GetBlogLambdaDataSource", {
        api,
        lambdaFunction: getBlogHandler,
        description: "Get Blog Lambda Data Source",
        name: "GetBlogLambdaDataSource",
      });

    // get blog (no dax) lambda data source
    const blogNoDaxDataSource: appsync.LambdaDataSource =
      new appsync.LambdaDataSource(this, "GetBlogNoDaxLambdaDataSource", {
        api,
        lambdaFunction: getBlogNoDaxHandler,
        description: "Get Blog (no dax) Lambda Data Source",
        name: "GetBlogNoDaxLambdaDataSource",
      });

    // dynamodb blog table (no dax) data source
    const blogTableDataSource: appsync.DynamoDbDataSource =
      new appsync.DynamoDbDataSource(this, "blogTableDataSource", {
        api,
        description: "Blog Table (no dax) Data Source",
        name: "blogTableDataSource",
        table: blogTable,
      });

    // listBlogs resolver going directly to lambda
    blogsDataSource.createResolver({
      typeName: "Query",
      fieldName: "listBlogs",
    });

    // getBlog by id resolver going directly to lambda
    blogDataSource.createResolver({
      typeName: "Query",
      fieldName: "getBlog",
    });

    // updateBlog mutation with cache invalidation
    blogTableDataSource.createResolver({
      typeName: "Mutation",
      fieldName: "updateBlog",
      // this is an example of a vtl template generated with the helper methods
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbPutItem(
        appsync.PrimaryKey.partition("id").is("input.id"),
        appsync.Values.projecting("input")
      ),
      // this is an example of an inline vtl response template (you can also pull in from a file)
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
      #set($cachingKeys = {})
      $util.qr($cachingKeys.put("context.arguments.id", $context.arguments.input.id))
      $extensions.evictFromApiCache("Query", "getBlogNoDax", $cachingKeys)

      $util.toJson($context.result)
      `),
    });

    // getBlog by id (no dax) resolver going directly to lambda
    // this also includes a cache of 30 seconds
    const getBlogNoDaxResolver: appsync.CfnResolver = new appsync.CfnResolver(
      this,
      "getBlogNoDaxResolver",
      {
        apiId: api.apiId,
        typeName: "Query",
        fieldName: "getBlogNoDax",
        cachingConfig: {
          ttl: cdk.Duration.seconds(30).toSeconds(),
          cachingKeys: ["$context.arguments.id"], // Valid values are entries from the $context.arguments, $context.source, and $context.identity maps
        },
        kind: "UNIT",
        dataSourceName: blogNoDaxDataSource.name,
      }
    );

    getBlogNoDaxResolver.node.addDependency(blogNoDaxDataSource);

    // add caching for the api
    new appsync.CfnApiCache(this, "appsync-cache", {
      apiCachingBehavior: "PER_RESOLVER_CACHING",
      apiId: api.apiId,
      ttl: cdk.Duration.seconds(30).toSeconds(), // cache for 30 seconds as default
      type: "SMALL",
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
    });

    // add a custom sdk call to invoke our create table lambda (this will add the dummy data on deploy)
    const lambdaInvokeSdkCall: customResources.AwsSdkCall = {
      service: "Lambda",
      action: "invoke",
      parameters: {
        FunctionName: "create-blogs-table",
      },
      physicalResourceId: customResources.PhysicalResourceId.of("BlogTable"),
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

    // run a custom resource lambda on deploy to populate the table with dummy data
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

    customResource.node.addDependency(createBlogsTableHandler);

    // dynamodb gateway endpoint to allow the lambdas in the private vpcs to call dynamodb
    const dynamoDbEndpoint = vpc.addGatewayEndpoint("DynamoDbEndpoint", {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // gateway endpoint policy
    dynamoDbEndpoint.addToPolicy(
      new iam.PolicyStatement({
        principals: [new iam.AnyPrincipal()],
        actions: [
          "dynamodb:List*",
          "dynamodb:DescribeReservedCapacity*",
          "dynamodb:DescribeLimits",
          "dynamodb:DescribeTimeToLive",
        ],
        resources: [blogTable.tableArn],
      })
    );

    dynamoDbEndpoint.addToPolicy(
      new iam.PolicyStatement({
        principals: [new iam.AnyPrincipal()],
        actions: [
          "dynamodb:BatchGet*",
          "dynamodb:DescribeStream",
          "dynamodb:DescribeTable",
          "dynamodb:Get*",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchWrite*",
          "dynamodb:CreateTable",
          "dynamodb:Delete*",
          "dynamodb:Update*",
          "dynamodb:PutItem",
        ],
        resources: [blogTable.tableArn],
      })
    );

    // useful exports
    new cdk.CfnOutput(this, "graphqlUrl", { value: api.graphqlUrl });
    new cdk.CfnOutput(this, "apiKey", { value: api.apiKey! });
    new cdk.CfnOutput(this, "apiId", { value: api.apiId });
    new cdk.CfnOutput(this, "daxClusterEndpointUrl", {
      value: blogsDaxCluster.attrClusterDiscoveryEndpointUrl,
    });
    new cdk.CfnOutput(this, "attrClusterDiscoveryEndpointUrl", {
      value: blogsDaxCluster.attrClusterDiscoveryEndpointUrl,
    });
  }
}
