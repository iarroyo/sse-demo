import Application from 'sse-demo/app';
import config from 'sse-demo/config/environment';
import { setApplication } from '@ember/test-helpers';
import { setup } from 'qunit-dom';
import { start } from 'ember-qunit';

setApplication(Application.create(config.APP));
setup(QUnit.assert);
start();
