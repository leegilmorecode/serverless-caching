import * as AWS from "aws-sdk";

import { AppSyncResolverEvent, AppSyncResolverHandler } from "aws-lambda";
import { Blog, QueryIdArgs } from "../../types";

import { v4 as uuid } from "uuid";

const dynamoDb: AWS.DynamoDB.DocumentClient = new AWS.DynamoDB.DocumentClient();

// Note: This handler resolves directly to dynamodb without caching using dax
export const getBlogNoDaxHandler: AppSyncResolverHandler<
  QueryIdArgs,
  Blog
> = async (
  event: AppSyncResolverEvent<QueryIdArgs, Record<string, any> | null>
): Promise<Blog> => {
  try {
    const correlationId = uuid();
    const method = "get-blog-no-dax.handler";
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
      ConsistentRead: true,
      Key: {
        id: event.arguments.id,
      },
    };

    // get the correct record back from dynamodb (note: no dax caching on this lambda)
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
