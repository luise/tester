const {Container, Service, publicInternet} = require("@quilt/quilt");
const fs = require('fs');
const path = require('path');

// XXX: Docker does not currently support uploading files to containers with a
// UID other than root. To get around this, we upload our files to a staging
// directory, and copy them into the Jenkins home directory (as the Jenkins
// user) before starting Jenkins.
var jenkinsStagingDir = "/tmp/files/"

exports.New = function(opts) {
    assertRequiredParameters(opts, [
        "awsAccessKey", "awsSecretAccessKey",
        "digitalOceanKey",
        "gceProjectID", "gcePrivateKey", "gceClientEmail",
        "testingNamespace",
        "slackTeam", "slackChannel", "slackToken"]);

    var container = new Container("quilt/tester",
        ["/bin/bash", "-c",
            "cp -r " + jenkinsStagingDir + ". /var/jenkins_home;" +
            "/bin/tini -s -- /usr/local/bin/jenkins.sh"]);
    container.setEnv("AWS_ACCESS_KEY", opts.awsAccessKey);
    container.setEnv("AWS_SECRET_ACCESS_KEY", opts.awsSecretAccessKey);
    container.setEnv("TESTING_NAMESPACE", opts.testingNamespace);
    container.setEnv("TZ", "/usr/share/zoneinfo/America/Los_Angeles");
    setupFiles(container, opts);

    var jenkins = new Service("jenkins", [container]);

    // Allow inbound connections to the Jenkins web UI.
    jenkins.allowFrom(publicInternet, 8080);

    // The tests talk to the deployed machines on various ports. We allow them here.
    publicInternet.allowFrom(jenkins, 22); // Required by `quilt ssh`.
    publicInternet.allowFrom(jenkins, 80); // Required by network tests.
    publicInternet.allowFrom(jenkins, 443); // Required by network tests.
    publicInternet.allowFrom(jenkins, 8000); // Required by network tests.
    publicInternet.allowFrom(jenkins, 9200); // Required by the elasticsearch test.
    publicInternet.allowFrom(jenkins, 9000); // Required by the Quilt daemon for API communication.
    publicInternet.allowFrom(jenkins, 9999); // Required by the Quilt daemon for minion communcation.

    return jenkins;
}

function setupFiles(jenkins, opts) {
    var files = [];

    files.push(new File(".digitalocean/key", opts.digitalOceanKey));

    var gceConfig = new File(".gce/quilt.json",
        applyTemplate(readRel("config/gce.json.tmpl"),
            {gceProjectID: opts.gceProjectID,
             gcePrivateKey: opts.gcePrivateKey,
             gceClientEmail: opts.gceClientEmail}));
    files.push(gceConfig);

    var rootConfig = new File("config.xml", readRel("config/jenkins/root.xml"));
    files.push(rootConfig);

    var scriptConfig = new File("scriptApproval.xml", readRel("config/jenkins/scriptApproval.xml"));
    files.push(scriptConfig);

    var goConfig = new File("org.jenkinsci.plugins.golang.GolangBuildWrapper.xml",
        readRel("config/jenkins/go.xml"));
    files.push(goConfig);

    var nodeConfig = new File("jenkins.plugins.nodejs.tools.NodeJSInstallation.xml",
        readRel("config/jenkins/node.xml"));
    files.push(nodeConfig);

    var jobConfig = new File("jobs/quilt-tester/config.xml",
        applyTemplate(readRel("config/jenkins/job.xml"),
            {slackTeam: opts.slackTeam,
             slackToken: opts.slackToken,
             slackChannel: opts.slackChannel}));
    files.push(jobConfig);

    if (opts.passwordHash !== undefined) {
        var adminConfig = new File("users/admin/config.xml",
            applyTemplate(readRel("config/jenkins/admin.xml"),
                {passwordHash: opts.passwordHash}));
        files.push(adminConfig);
    }

    if (opts.jenkinsUrl !== undefined) {
        var locConfig = new File("jenkins.model.JenkinsLocationConfiguration.xml",
            applyTemplate(readRel("config/jenkins/location.xml"),
                {jenkinsUrl: opts.jenkinsUrl}));
        files.push(locConfig);
    }

    files.forEach(function(f) {
        jenkins.filepathToContent[jenkinsStagingDir + f.path] = f.content
    });
}

// applyTemplate replaces the keys defined by `vars` with their corresponding
// values in `template`. A variable is denoted in the template using {{key}}.
function applyTemplate(template, vars) {
    for (k in vars) {
        template = template.replace("{{" + k + "}}", vars[k]);
    }
    return template;
}

function assertRequiredParameters(opts, requiredKeys) {
    requiredKeys.forEach(function(key) {
        if (opts[key] === undefined) {
            throw key + " is required"
        }
    })
}

function File(path, content) {
    this.path = path;
    this.content = content;
}

function readRel(file) {
    return fs.readFileSync(path.join(__dirname, file), {encoding: 'utf8'});
}
