import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as GarbageDisposalNotification from '../lib/garbage-disposal-notification-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new GarbageDisposalNotification.GarbageDisposalNotificationStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
