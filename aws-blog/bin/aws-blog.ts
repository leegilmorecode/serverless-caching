#!/usr/bin/env node

import "source-map-support/register";

import * as cdk from "@aws-cdk/core";

import { AwsBlogStack } from "../lib/aws-blog-stack";

const app = new cdk.App();
new AwsBlogStack(app, "AwsBlogStack", {});
