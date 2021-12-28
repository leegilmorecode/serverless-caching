import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";

import { v4 as uuid } from "uuid";

const data = require("data-api-client")({
  secretArn: process.env.SECRET_ARN as string,
  resourceArn: process.env.CLUSTER_ARN as string,
  database: process.env.DB,
  continueAfterTimeout: true,
  includeResultMetadata: false,
});

// cachedBlogs is outside of the handler and will persist between invocations
// Note: the related api gateway endpoint does not have caching enabled

let cachedBlogs: BlogsResponse;

export const listBlogsCachedInMemoryHandler: APIGatewayProxyHandler =
  async (): Promise<APIGatewayProxyResult> => {
    try {
      const correlationId = uuid();
      const method = "list-blogs-cache-in-memory.handler";
      const prefix = `${correlationId} - ${method}`;

      console.log(`${prefix} - started`);

      // if no blogs have been cached previously then we need to fetch from the db
      if (!cachedBlogs?.items?.length) {
        console.log(
          `${prefix} - no blogs cached in memory.. fetching blogs from db`
        );

        const { records }: { records: BlogResponse[] } = await data.query(
          "select * from Blogs;"
        );

        // populate our in memory cache with the retrieved blogs
        cachedBlogs = {
          items: [...records],
          responseDateTime: new Date().toUTCString(), // we add this simply to see the caching working
        };
      } else {
        console.log(
          `${prefix} - ${cachedBlogs.items.length} blogs cached in memory.. no need to go to db!`
        );
      }

      console.log(`${prefix} - successful: ${JSON.stringify(cachedBlogs)}`);

      return {
        body: JSON.stringify(cachedBlogs),
        statusCode: 200,
      };
    } catch (error) {
      return {
        body: "An error has occurred",
        statusCode: 500,
      };
    }
  };
