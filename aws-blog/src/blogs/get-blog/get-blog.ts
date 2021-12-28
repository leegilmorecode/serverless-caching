import {
  APIGatewayEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";

import { v4 as uuid } from "uuid";

const data = require("data-api-client")({
  secretArn: process.env.SECRET_ARN as string,
  resourceArn: process.env.CLUSTER_ARN as string,
  database: process.env.DB,
  continueAfterTimeout: true,
  includeResultMetadata: false,
});

export const getBlogHandler: APIGatewayProxyHandler = async ({
  pathParameters,
}: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
  try {
    const correlationId = uuid();
    const method = "get-blog.handler";
    const prefix = `${correlationId} - ${method}`;

    console.log(`${prefix} - started`);

    if (!pathParameters) {
      throw new Error("Blog Id not defined");
    }

    const blogId = pathParameters["id"];

    console.log(`${prefix} - Blog Id: ${blogId}`);

    // get the correct record back
    const { records }: { records: BlogResponse[] } = await data.query(
      `select * from blogsdb.Blogs where blogID = ${blogId};`
    );

    if (!records.length) {
      throw new Error("blog not found");
    }

    const response: BlogResponse = records[0];
    response.responseDateTime = new Date().toUTCString(); // we add this simply to see the caching working

    return {
      body: JSON.stringify(response),
      statusCode: 200,
    };
  } catch (error) {
    return {
      body: "An error has occurred",
      statusCode: 500,
    };
  }
};
