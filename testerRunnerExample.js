// This file deploys a Jenkins instance running integration-tester. It shows an example
// of all paramters to `tester.New`. It uses a floating IP to automatically
// configure `jenkinsUrl`.

const { Infrastructure, Machine } = require('kelda');
const Tester = require('./tester.js');

const baseMachine = new Machine({ provider: 'Amazon' });

const worker = baseMachine.clone();
worker.floatingIp = '8.8.8.8';

const tester = new Tester({
  awsAccessKey: 'accessKey',
  awsSecretAccessKey: 'secret',
  gceProjectID: 'projectID',
  gcePrivateKey: 'privateKey',
  gceClientEmail: 'email',
  digitalOceanKey: 'key',
  testingNamespacePrefix: 'integration-tester',
  slackTeam: 'kelda-dev',
  slackChannel: '#testing',
  slackToken: 'secret',
  // Because of a bug with the `applyTemplate` function, dollar sign literals
  // (`$`) need to be replaced with `$$`.
  passwordHash: '#jbcrypt:$$2a$$10$$Jcwink6XXoUIp3Ieh.1QR.Mx5idVA7QNLHNcF2jQWhoCA96y5k/jS',
  jenkinsUrl: `http://${worker.floatingIp}:8080`,
});

const infra = new Infrastructure(baseMachine, worker);
tester.deploy(infra);
