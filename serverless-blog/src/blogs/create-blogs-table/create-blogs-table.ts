import * as AWS from "aws-sdk";

import {
  CdkCustomResourceHandler,
  CdkCustomResourceResponse,
} from "aws-lambda";

import { v4 as uuid } from "uuid";

const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const createBlogsTableHandler: CdkCustomResourceHandler =
  async (): Promise<CdkCustomResourceResponse> => {
    try {
      const correlationId = uuid();
      const method = "create-blogs-table.handler";
      const prefix = `${correlationId} - ${method}`;

      console.log(`${prefix} - started`);

      const tableName = process.env.TABLE_NAME;

      if (!tableName) throw new Error("table name is not supplied in config");

      console.log(`${prefix} - creating records`);

      const params: AWS.DynamoDB.DocumentClient.BatchWriteItemInput = {
        RequestItems: {
          [tableName]: [
            {
              PutRequest: {
                Item: {
                  id: "1",
                  blogTitle: "Lambda News",
                  blogBody: "Lambda memory increased to 10GB",
                  blogDate: new Date().toISOString(),
                },
              },
            },
            {
              PutRequest: {
                Item: {
                  id: "2",
                  blogTitle: "Serverless Kafka!",
                  blogBody: "Serverless MSK is now a thing!",
                  blogDate: new Date().toISOString(),
                },
              },
            },
            {
              PutRequest: {
                Item: {
                  id: "3",
                  blogTitle: "DynamoDB Infrequent Access",
                  blogBody: "this could save you 60% costs",
                  blogDate: new Date().toISOString(),
                },
              },
            },
          ],
        },
      };

      await dynamoDb.batchWrite(params).promise();

      console.log(`${prefix} - successfully created records`);

      return {
        success: true,
      };
    } catch (error) {
      console.error(error);
      throw error;
    }
  };
