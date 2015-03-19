'use strict';

var fs = require('fs'),
    api = require('./api'),
    webhooks = require('./webhooks'),
    hostname = process.env.strider_server_name || 'http://localhost:3000',
    stashStrategy = require('passport-stash').Strategy,
    apiURL = process.env.STASH_API_URL || '',
    consumerKey = process.env.STASH_CONSUMER_KEY || '',
    consumerSecret = fs.readFileSync(process.env.STASH_PEM_FILE,
                                     {encoding: 'utf8'});



module.exports = {
    // this is the project-level config
    // project.provider.config
    config: {
        url: String,
        owner: String,
        repo: String,
        cache: Boolean,
        pull_requests: {type: String, enum: ['all', 'none', 'whitelist']},
        whitelist: [{
            name: String,
            level: {type: String, enum: ['tester', 'admin']}
        }],
        // used for the webhook
        secret: String,
        // type: https || ssh
        auth: {}
    },

    auth: function(passport, context) {
        var callbackURL = hostname + '/auth/stash/callback';

        if (!apiURL.length || !consumerKey.length || !consumerSecret.length) {
            throw new Error('Stash plugin misconfigured! Need `Consumer Key`, `Consumer Secret` and `API URL`.');
        }

        passport.use(new stashStrategy({
            consumerKey : consumerKey,
            consumerSecret: consumerSecret,
            apiURL: apiURL,
            callbackURL : callbackURL,
            passReqToCallback: true
        }, validateAuth));
    },

    // this is called when building the "manage projects" page. The
    // results are passed to the angular controller as "repos".
    listRepos: function (account, next) {
        api.getRepos(account.token, account.tokenSecret, function (err, repos) {
            next(err, repos);
        });
    },

    setupRepo: function (account, config, project, done) {
        var url = makeWebHookURL(project);
        var repo = makeRepoConfig(project);
        if (!account.token) {
            return done(new Error('Stash account not configured'));
        }
        api.createHook(repo.owner, repo.name, url, account.token, account.tokenSecret, function (err) {
            if (err) return done(err);
            return done(null, config);
        });
    },

    teardownRepo: function (account, config, project, done) {
        var url = makeWebHookURL(project);
        var repo = makeRepoConfig(project);
        if (!account.token) {
            return done(new Error('Stash account not configured'));
        }
        api.deleteHook(repo.owner, repo.name, url, account.token, account.tokenSecret, function (err, deleted) {
            if (err) return done(err);
            return done();
        });
    },

    getBranches: function(account, config, project, done) {
        var repo = makeRepoConfig(project);
        api.getBranches(repo.owner, repo.name, account.token, account.tokenSecret, done);
    },

    getFile: function (filename, ref, account, config, project, done) {
        var baseref = ref.id || ref.branch || ref.tag || 'master';
        var repo = makeRepoConfig(project);
        api.getFile(filename, baseref, account.config.token, account.config.tokenSecret, repo.owner, repo.name, done);
    },

    // will be namespaced under /:org/:repo/api/stash
    routes: function (app, context) {
        // config
        app.get('config', context.auth.requireProjectAdmin, function (req, res) {
            res.send(req.providerConfig());
        });
        app.put('config', context.auth.requireProjectAdmin, function (req, res) {
            // validate the config
            var config = sanitizeConfig(req.body);
            req.providerConfig(config, function (err) {
                if (err) {
                    res.status(500);
                    return res.send({errors: [err.message]});
                }
                res.send({success: true, message: 'Saved Stash config!', config: config});
            });
        });

        // hook
        app.post('/hook', function (req, res) {
            var url = config.hostname + '/' + req.project.name + '/api/stash/webhook'
            , account = req.accountConfig()
            , pconfig = req.providerConfig();
            if (!account.accessToken) return res.send(400, 'Stash account not configured');
            api.createHooks(req.project.name, url, pconfig.secret, account.accessToken, function (err) {
                if (err) return res.send(500, err.message);
                res.send(200, 'Webhook registered');
            });
        });
        app.delete('/hook', function (req, res) {
            var url = config.hostname + '/' + req.project.name + '/api/stash/webhook'
            , account = req.accountConfig();
            if (!account.accessToken) return res.send(400, 'Stash account not configured');
            api.deleteHooks(req.project.name, url, account.accessToken, function (err, deleted) {
                if (err) return res.send(500, err.message);
                res.send(200, deleted ? 'Webhook removed' : 'No webhook to delete');
            });
        });

        // stash should hit this endpoint
        app.anon.get('/webhook', webhooks.receiveWebhook.bind(null, context.emitter))
    },
    // app is namespaced to /ext/stash, app.context isn't
    // we use app.context to keep the original url structure for backwards compat
    globalRoutes: function (app, context) {
        context.app.get('/auth/stash', context.passport.authenticate('stash'));
        context.app.get(
            '/auth/stash/callback',
            context.passport.authenticate('stash', { failureRedirect: '/login' }),
            function(req, res){
                res.redirect('/projects');
            });
    }
};

function validateAuth(req, token, tokenSecret, profile, done) {
    if (!req.user) {
        console.warn('Stash OAuth but no logged-in user');
        req.flash('account', 'Cannot link a stash account if you aren\'t logged in');
        return done();
    }

    var account = req.user.account('stash', req.user.email);

    if (account) {
        console.warn('Trying to attach a Stash account that\'s already attached...');
        req.flash('account', 'That github account is already linked. <a target="_blank" href="' + apiURL + '/j_security_logout">Sign out of github</a> before you click "Add Account"');
        return done(null, req.user);
    }

    req.user.accounts.push(makeAccount(token, tokenSecret, req.user));
    req.user.save(function (err) {
        done(err, req.user);
    });
};

function makeAccount(token, tokenSecret, user) {
    return {
        provider: 'stash',
        id: user.email,
        // display_url: profile.profileUrl,
        title: "Stash",
        config: {
            token: token,
            tokenSecret: tokenSecret,
            email: user.email,
            gravatarId: user.email,
            name: user.email
        },
        cache: []
    };
}

function makeRepoConfig(project) {
    return {
        owner: project.provider.config.owner,
        name: project.provider.config.repo
    };
}

function makeWebHookURL(project) {
    return hostname + '/' + project.name + '/api/stash/webhook';
}
