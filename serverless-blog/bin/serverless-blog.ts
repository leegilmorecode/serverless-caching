#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "@aws-cdk/core";

import { ServerlessBlogStack } from "../lib/serverless-blog-stack";

const app = new cdk.App();
new ServerlessBlogStack(app, "ServerlessBlogStack", {});
