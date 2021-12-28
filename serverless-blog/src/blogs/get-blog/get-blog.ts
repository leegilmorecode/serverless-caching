import * as AWS from "aws-sdk";

import { AppSyncResolverEvent, AppSyncResolverHandler } from "aws-lambda";
import { Blog, QueryIdArgs } from "../../types";

import { v4 as uuid } from "uuid";

const AmazonDaxClient = require("amazon-dax-client");

const dax = new AmazonDaxClient({
  endpoints: [process.env.DAX_ENDPOINT],
  region: process.env.REGION,
});
const dynamoDb: AWS.DynamoDB.DocumentClient = new AWS.DynamoDB.DocumentClient({
  service: dax,
});

export const getBlogHandler: AppSyncResolverHandler<QueryIdArgs, Blog> = async (
  event: AppSyncResolverEvent<QueryIdArgs, Record<string, any> | null>
): Promise<Blog> => {
  try {
    const correlationId = uuid();
    const method = "get-blog.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    console.log(
      `${prefix} - event args: ${JSON.stringify(event.arguments.id)}`
    );
    console.log(`${prefix} - event request: ${JSON.stringify(event.request)}`);
    console.log(`${prefix} - event source: ${JSON.stringify(event.source)}`);
    console.log(`${prefix} - event info: ${JSON.stringify(event.info)}`);

    const params: AWS.DynamoDB.DocumentClient.GetItemInput = {
      TableName: process.env.TABLE_NAME as string,
      ConsistentRead: false,
      Key: {
        id: event.arguments.id,
      },
    };

    // get the correct record back from dax or dynamodb
    const { Item: data }: AWS.DynamoDB.DocumentClient.GetItemOutput =
      await dynamoDb.get(params).promise();

    if (!data) throw new Error("item not found");

    const response: Blog = {
      id: data.id,
      blogDate: data.blogDate,
      blogTitle: data.blogTitle,
      blogBody: data.blogBody,
    };

    console.log(`response: ${response}`);

    return response;
  } catch (error) {
    console.log(`Error: ${error}`);
    throw error;
  }
};
