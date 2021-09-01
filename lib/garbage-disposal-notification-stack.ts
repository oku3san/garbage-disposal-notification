import * as cdk from '@aws-cdk/core';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2';
import * as apigatewayv2Integration from '@aws-cdk/aws-apigatewayv2-integrations';
import * as logs from '@aws-cdk/aws-logs';
import * as certificatemanager from '@aws-cdk/aws-certificatemanager';
import * as route53 from "@aws-cdk/aws-route53";
import * as ssm from "@aws-cdk/aws-ssm";
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import * as lambda from '@aws-cdk/aws-lambda';
import * as iam from '@aws-cdk/aws-iam';

export class GarbageDisposalNotificationStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const accessToken:any = ssm.StringParameter.valueFromLookup(this, 'line_access_token')
    const channelSecret:any = ssm.StringParameter.valueFromLookup(this, 'line_channel_secret')
    const userId:any = ssm.StringParameter.valueFromLookup(this, 'line_user_id')

    const domain:string = ssm.StringParameter.valueFromLookup(this, 'domain')

    const hostedZone = route53.HostedZone.fromLookup(this, "hostedZone", {
      domainName: domain
    });

    const lineApiAcm = new certificatemanager.Certificate(this, 'lineApiAcm', {
      domainName: 'lineapi.' + domain,
      validation: certificatemanager.CertificateValidation.fromDns(hostedZone),
    });

    const garbageTable = new dynamodb.Table(this, 'garbageTable', {
      partitionKey: { name: 'Id', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const lineBotNodejsFunction = new lambda.DockerImageFunction(this, 'lineBotNodejsFunction', {
      code: lambda.DockerImageCode.fromImageAsset("Lambda/Response"),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        accessToken: accessToken,
        channelSecret: channelSecret,
        garbageTable: garbageTable.tableName.toString(),
        NEW_RELIC_LAMBDA_EXTENSION_ENABLED: 'true',
        NEW_RELIC_LAMBDA_HANDLER: 'index.handler',
        NEW_RELIC_ACCOUNT_ID: ssm.StringParameter.valueFromLookup(this, 'newrelic_external_id')
      },
      deadLetterQueueEnabled: true,
    });

    lineBotNodejsFunction.addToRolePolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: ['secretsmanager:GetSecretValue']
    }));

    const lineBotHttpApiDomain = new apigatewayv2.DomainName(this, 'lineBotHttpApiDomain', {
      domainName: "lineapi." + domain,
      certificate: lineApiAcm
    })

    const lineBotHttpApi = new apigatewayv2.HttpApi(this, 'lineBotHttpApi', {
      apiName: 'LineBotHttpApi',
      defaultDomainMapping: {
        domainName: lineBotHttpApiDomain
      }
    });

    lineBotHttpApi.addRoutes({
      path: '/',
      methods: [ apigatewayv2.HttpMethod.POST ],
      integration: new apigatewayv2Integration.LambdaProxyIntegration({
        handler: lineBotNodejsFunction
      })
    })

    new route53.CnameRecord(this, 'cnameRecord', {
      zone: hostedZone,
      domainName: lineBotHttpApiDomain.regionalDomainName,
      recordName: 'lineapi',
    })

    const lineBotForCronNodejsFunction = new lambda.DockerImageFunction(this, "lineBotForCronNodejsFunction", {
      code: lambda.DockerImageCode.fromImageAsset("Lambda/Cron"),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        accessToken: accessToken,
        channelSecret: channelSecret,
        userId: userId,
        garbageTable: garbageTable.tableName.toString(),
        NEW_RELIC_LAMBDA_EXTENSION_ENABLED: 'true',
        NEW_RELIC_LAMBDA_HANDLER: 'index.handler',
        NEW_RELIC_ACCOUNT_ID: ssm.StringParameter.valueFromLookup(this, 'newrelic_external_id')
      },
      deadLetterQueueEnabled: true,
    });

    lineBotForCronNodejsFunction.addToRolePolicy(new iam.PolicyStatement({
      resources: ['*'],
      actions: ['secretsmanager:GetSecretValue']
    }));

    garbageTable.grantReadWriteData(lineBotNodejsFunction);
    garbageTable.grantReadWriteData(lineBotForCronNodejsFunction);

    new events.Rule(this, "scheduleEvent", {
      schedule: events.Schedule.cron({
        minute: "0,30",
        hour: "13-14",
        day: "*",
        month: "*",
        year: "*"
      }),
      targets: [new targets.LambdaFunction(lineBotForCronNodejsFunction)]
    });
  }
}
