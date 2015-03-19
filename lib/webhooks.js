'use strict';

module.exports = {
    receiveWebhook: receiveWebhook,
    pushJob: pushJob
};

function makeJob(project, config) {
    var now = new Date(),
        deploy = false,
        branch,
        job;

    branch = project.branch(config.branch) || {active: true,
                                               mirror_master: true,
                                               deploy_on_green: false};
    if (!branch.active) return false;
    if (config.branch !== 'master' && branch.mirror_master) {
        // mirror_master branches don't deploy
        deploy = false;
    } else {
        deploy = config.deploy && branch.deploy_on_green;
    }
    job = {
        type: deploy ? 'TEST_AND_DEPLOY' : 'TEST_ONLY',
        trigger: config.trigger,
        project: project.name,
        ref: config.ref,
        plugin_data: config.plugin_data || {},
        user_id: project.creator._id,
        created: now
    };
    return job;
}

function startFromCommit(project, payload, send) {
    var config = pushJob(payload),
        branch = project.branch(config.branch),
        job;

    if (branch) {
        job = makeJob(project, config);
        if (job) {
            console.log("sending job");
            return send(job);
        }
    }
    console.log("appears we are not starting things....");
    return false;
}

function pushJob(payload) {
    var branchname,
        commit = payload.hash,
        trigger,
        ref;

    trigger = {
        type: 'commit',
        author: {
            name: payload.author
        },
        message: payload.message,
        source: {
            type: 'plugin',
            plugin: 'stash'
        }
    };

    return {
        branch: payload.branch,
        trigger: trigger,
        deploy: true,
        ref: commit
    };
}

function receiveWebhook(emitter, req, res) {
    console.log('req:', req.query);
    var payload = req.query;
    if (payload.hash === undefined) {
        console.error('Webhook payload failed to parse as JSON');
        return res.send(400, 'Invalid payload');
    }

    res.send(200);

    startFromCommit(req.project, payload, sendJob);

    function sendJob(job) {
        emitter.emit('job.prepare', job);
    }
}
