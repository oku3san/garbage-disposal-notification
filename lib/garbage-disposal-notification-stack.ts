import {Stack, StackProps, RemovalPolicy} from 'aws-cdk-lib';
import { Construct } from "constructs";
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2alpha from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigatewayv2Integration from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from "aws-cdk-lib/aws-route53";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';

export class GarbageDisposalNotificationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
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
      removalPolicy: RemovalPolicy.RETAIN
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

    const lineBotHttpApiDomain = new apigatewayv2alpha.DomainName(this, 'lineBotHttpApiDomain', {
      domainName: "lineapi." + domain,
      certificate: lineApiAcm
    })

    const lineBotHttpApi = new apigatewayv2alpha.HttpApi(this, 'lineBotHttpApi', {
      apiName: 'LineBotHttpApi',
      defaultDomainMapping: {
        domainName: lineBotHttpApiDomain
      }
    });

    lineBotHttpApi.addRoutes({
      path: '/',
      methods: [ apigatewayv2alpha.HttpMethod.POST ],
      // integration: new apigatewayv2Integration.LambdaProxyIntegration({
      //   handler: lineBotNodejsFunction
      // })
      integration: new apigatewayv2Integration.HttpLambdaIntegration('apigatewayv2Integration', lineBotNodejsFunction)
    });

    // console.log(lineBotHttpApi.node.findChild('POST--').node.findChild('apigatewayv2Integration').node.findChild('Resource'))
    // const defaultRoute = lineBotHttpApi.node.findChild('POST--');
    // console.log(defaultRoute)
    // const myInt = defaultRoute.node.findChild('HttpIntegration');
    // console.log(myInt)
    const resource = lineBotHttpApi.node.findChild('POST--').node.findChild('apigatewayv2Integration').node.findChild('Resource') as apigatewayv2.CfnIntegration;
    resource.overrideLogicalId('lineBotHttpApiPOSTHttpIntegration0bbd09debedb610c70dde7fc9f80d0791463B9B6');

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
