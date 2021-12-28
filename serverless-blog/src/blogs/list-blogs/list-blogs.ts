import * as AWS from "aws-sdk";

import { AppSyncResolverEvent, AppSyncResolverHandler } from "aws-lambda";
import { Blog, NoArgs } from "../../types";

import { v4 as uuid } from "uuid";

const AmazonDaxClient = require("amazon-dax-client");

const dax = new AmazonDaxClient({
  endpoints: [process.env.DAX_ENDPOINT],
  region: process.env.REGION,
});
const dynamoDb = new AWS.DynamoDB.DocumentClient({ service: dax });

export const listBlogsHandler: AppSyncResolverHandler<NoArgs, Blog[]> = async (
  event: AppSyncResolverEvent<NoArgs, Record<string, any> | null>
): Promise<Blog[]> => {
  try {
    const correlationId = uuid();
    const method = "list-blogs.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    console.log(`${prefix} - event request: ${JSON.stringify(event.request)}`);
    console.log(`${prefix} - event source: ${JSON.stringify(event.source)}`);
    console.log(`${prefix} - event info: ${JSON.stringify(event.info)}`);

    const params: AWS.DynamoDB.DocumentClient.ScanInput = {
      TableName: process.env.TABLE_NAME as string,
      ConsistentRead: false,
    };

    // get the correct records back from dax or dynamodb
    const { Items: data }: AWS.DynamoDB.DocumentClient.ScanOutput =
      await dynamoDb.scan(params).promise();

    if (!data || !data.length) throw new Error("items not found");

    const response: Blog[] = data.map((item) => ({
      id: item.id,
      blogTitle: item.blogTitle,
      blogBody: item.blogBody,
      blogDate: item.blogDate,
    }));

    console.log(`response: ${response}`);

    return response;
  } catch (error) {
    console.log(error);
    throw error;
  }
};
