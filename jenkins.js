const { Container, publicInternet, allowTraffic } = require('kelda');
const fs = require('fs');
const path = require('path');

// XXX: Docker does not currently support uploading files to containers with a
// UID other than root. To get around this, we upload our files to a staging
// directory, and copy them into the Jenkins home directory (as the Jenkins
// user) before starting Jenkins.
const jenkinsStagingDir = '/tmp/files/';

const releaserKeyPath = '~/jobs/releaserKey';

/**
 * trimPrefix removes `prefix` from `str` if it begins with `prefix`.
 *
 * @param {string} str - The string from which `prefix` should be removed.
 * @param {string} prefix - The string to remove.
 * @returns {string} - The trimmed string.
 */
function trimPrefix(str, prefix) {
  return str.replace(new RegExp(`^${prefix}`), '');
}

// applyTemplate replaces the keys defined by `vars` with their corresponding
// values in `template`. A variable is denoted in the template using {{key}}.
function applyTemplate(templateArg, vars) {
  let template = templateArg;
  Object.keys(vars).forEach((k) => {
    template = template.replace(`{{${k}}}`, vars[k]);
  });
  return template;
}

function assertRequiredParameters(opts, requiredKeys) {
  requiredKeys.forEach((key) => {
    if (opts[key] === undefined) {
      throw new Error(`${key} is required`);
    }
  });
}

function File(filepath, content) {
  this.path = filepath;
  this.content = content;
}

function readRel(file) {
  return fs.readFileSync(path.join(__dirname, file), { encoding: 'utf8' });
}

function setupFiles(opts, scp) {
  const files = [];

  files.push(new File('.digitalocean/key', opts.digitalOceanKey));

  const gceConfig = new File('.gce/kelda.json',
    applyTemplate(readRel('config/gce.json.tmpl'),
      { gceProjectID: opts.gceProjectID,
        gcePrivateKey: opts.gcePrivateKey,
        gceClientEmail: opts.gceClientEmail }));
  files.push(gceConfig);

  const rootConfig = new File('config.xml', readRel('config/jenkins/root.xml'));
  files.push(rootConfig);

  const scriptConfig = new File('scriptApproval.xml', readRel('config/jenkins/scriptApproval.xml'));
  files.push(scriptConfig);

  const goConfig = new File('org.jenkinsci.plugins.golang.GolangBuildWrapper.xml',
    readRel('config/jenkins/go.xml'));
  files.push(goConfig);

  const nodeConfig = new File('jenkins.plugins.nodejs.tools.NodeJSInstallation.xml',
    readRel('config/jenkins/node.xml'));
  files.push(nodeConfig);

  const knownHostsPath = '~/jobs/known_hosts';
  files.push(new File(trimPrefix(releaserKeyPath, '~/'), scp.userKeyPair.priv));
  files.push(new File(trimPrefix(knownHostsPath, '~/'),
    `${scp.getHostname()} ${scp.hostKeyPair.pub}`));

  const templateOpts = {
    // The ${KELDA_VERSION} string is not meant to be evaluated in the Javascript.
    // It should get expanded by Jenkins when the build runs.
    // eslint-disable-next-line no-template-curly-in-string
    copyCommand: scp.getCommand('releases/${KELDA_VERSION}.tar.gz', 'release.tar.gz', {
      identityFile: releaserKeyPath,
      knownHostsFile: knownHostsPath,
    }),
  };
  const providersToTest = [
    { provider: 'Amazon', size: 'm3.medium' },
    { provider: 'Google', size: 'n1-standard-1' },
    { provider: 'DigitalOcean', size: '2gb' },
  ];
  providersToTest.forEach((provider) => {
    const keldaTesterConfig = new File(
      `jobs/integration-tester-${provider.provider}/config.xml`,
      applyTemplate(readRel('config/jenkins/integration-tester.xml'),
        Object.assign(templateOpts, {
          provider: provider.provider,
          size: provider.size })));
    files.push(keldaTesterConfig);
  });

  const checkDepsConfig = new File('jobs/check-dependencies/config.xml',
    applyTemplate(readRel('config/jenkins/check-dependencies.xml'),
      { slackTeam: opts.slackTeam,
        slackToken: opts.slackToken,
        slackChannel: opts.slackChannel }));
  files.push(checkDepsConfig);

  if (opts.passwordHash !== undefined) {
    const adminConfig = new File('users/admin/config.xml',
      applyTemplate(readRel('config/jenkins/admin.xml'),
        { passwordHash: opts.passwordHash }));
    files.push(adminConfig);
  }

  if (opts.jenkinsUrl !== undefined) {
    const locConfig = new File('jenkins.model.JenkinsLocationConfiguration.xml',
      applyTemplate(readRel('config/jenkins/location.xml'),
        { jenkinsUrl: opts.jenkinsUrl }));
    files.push(locConfig);
  }

  return files;
}

exports.New = function New(opts, scp) {
  assertRequiredParameters(opts, [
    'awsAccessKey', 'awsSecretAccessKey',
    'awsS3AccessKey', 'awsS3SecretAccessKey',
    'digitalOceanKey',
    'gceProjectID', 'gcePrivateKey', 'gceClientEmail',
    'testingNamespacePrefix',
    'slackWebhook', 'slackChannel']);

  const jenkins = new Container('jenkins', 'keldaio/tester', {
    command: ['/bin/bash', '-c',
      `cp -r ${jenkinsStagingDir}. /var/jenkins_home;` +
      `chmod 0600 ${releaserKeyPath};` +
            '/bin/tini -s -- /usr/local/bin/jenkins.sh'],
  });
  jenkins.setEnv('AWS_ACCESS_KEY', opts.awsAccessKey);
  jenkins.setEnv('AWS_SECRET_ACCESS_KEY', opts.awsSecretAccessKey);
  // Set different environment variables with the keys that have access only to
  // S3.
  jenkins.setEnv('AWS_S3_ACCESS_KEY_ID', opts.awsS3AccessKey);
  jenkins.setEnv('AWS_S3_SECRET_ACCESS_KEY', opts.awsS3SecretAccessKey);
  jenkins.setEnv('TESTING_NAMESPACE_PREFIX', opts.testingNamespacePrefix);
  jenkins.setEnv('SLACK_WEBHOOK', opts.slackWebhook);
  jenkins.setEnv('SLACK_CHANNEL', opts.slackChannel);
  jenkins.setEnv('TZ', '/usr/share/zoneinfo/America/Los_Angeles');

  const files = setupFiles(opts, scp);
  files.forEach((f) => {
    jenkins.filepathToContent[jenkinsStagingDir + f.path] = f.content;
  });

  // Allow inbound connections to the Jenkins web UI.
  allowTraffic(publicInternet, jenkins, 8080);

  // The tests talk to the deployed machines on various ports. We allow them here.
  allowTraffic(jenkins, publicInternet, 22); // Required by `kelda ssh`.
  allowTraffic(jenkins, publicInternet, 80); // Required by network tests.
  allowTraffic(jenkins, publicInternet, 443); // Required by network tests.
  allowTraffic(jenkins, publicInternet, 3000); // Required by the lobsters test.
  allowTraffic(jenkins, publicInternet, 5601); // Required by the Kibana test.
  allowTraffic(jenkins, publicInternet, 8000); // Required by network tests.
  allowTraffic(jenkins, publicInternet, 9200); // Required by the elasticsearch test.
  allowTraffic(jenkins, publicInternet, 9000); // Required by Kelda daemon for API communication.
  allowTraffic(jenkins, publicInternet, 9999); // Required by Kelda daemon for minion communcation.

  // Allow outbound connections to Git servers. Required by `npm install`.
  allowTraffic(jenkins, publicInternet, 9418);

  return jenkins;
};
