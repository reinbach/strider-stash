var _ = require('lodash'),
    request = require('request'),
    superagent = require('superagent'),
    qs = require('querystring'),
    fs = require('fs'),
    url = require('url'),
    async = require('async'),
    debug = require('debug')('strider-stash:api'),
    passport = require('passport'),
    apiURL = process.env.STASH_API_URL || '',
    consumerKey = process.env.STASH_CONSUMER_KEY || '',
    consumerSecret = fs.readFileSync(process.env.STASH_PEM_FILE,
                                     {encoding: 'utf8'});

var STASH_API_ENDPOINT = apiURL + "/rest/api/1.0";


module.exports = {
    passport: passport,
    getRepos: getRepos,
    getFile: getFile,
    getBranches: getBranches,
    createHooks: createHooks,
    deleteHooks: deleteHooks
};

/*
 * get_oauth1()
 *
 * Do a HTTP GET w/ OAuth1 token
 * <url> URL to GET
 * <params> Object representing the query params to be added to GET request
 * <access_token> OAuth1 access token
 * <callback> function(error, response, body)
 */
var get_request_options = function(url, params, form, token, token_secret) {
    oauth = {
        consumer_key: consumerKey,
        private_key: consumerSecret,
        token: token,
        token_secret: token_secret,
        signature_method: 'RSA-SHA1'
    };
    var options = {url: url, oauth: oauth, qs: params, json: true};
    if (form != undefined) {
        options.body = form;
    }
    console.debug('GET OAUTH1 URL:', options);
    return options;
};

/*
 * pageinated_api_call()
 *
 * Simple HTTP Get Stash API wrapper with support for pageination via
 * Link header.
 * See: http://developer.github.com/v3/#pagination
 *
 * <path> API call URL path
 * <token> Oauth1 access token
 * <token_secret> Oauth1 access token secret
 * <callback> function(error, response, de-serialized json)
 *
 */
var pageinated_api_call = function(path, token, token_secret, callback) {
    var base_url = STASH_API_ENDPOINT + path;

    if (!token) {
        console.error("Error in request - no access token");
        console.trace();
    }

    // This is a left fold,
    // a recursive function closed over an accumulator

    var pages = [];

    function loop(uri, page) {
        console.debug('PAGINATED API CALL URL:', uri);
        var options = get_request_options(uri, {start: page}, null, token,
                                          token_secret);
        request.get(options, function(error, response, data) {
            //test
            console.log(data);
            if (!error && response.statusCode == 200) {
                pages.push(data.values);

                if (data.isLastPage === true) {
                    callback(null, {data:_.flatten(pages),
                                    response: response});
                } else {
                    // Request next page and continue
                    var next_page = data.start + 1;
                    loop(base_url, next_page);
                }
            } else {
                if (!error){
                    if (response.statusCode === 401 || response.statusCode === 403) {
                        return callback(new Error('Stash app is not authorized. Did you revoke access?'));
                    }
                    return callback(new Error("Status code is " + response.statusCode + " not 200. Body: " + data));
                } else {
                    return callback(error, null);
                }
            }
        });
    }

    // Start from page 0
    loop(base_url, 0);
};

/*
 * api_call()
 *
 * Simple HTTP GET Stash API wrapper.
 * Makes it easy to call most read API calls.
 * <path> API call URL path
 * <access_token> OAuth1 access token
 * <callback> function(error, response, de-serialized json)
 * <params> Additional query params
 */
var api_call = exports.api_call = function(path, access_token, callback, client, params) {
    client = client || request;
    var url = STASH_API_ENDPOINT + path;
    console.debug('API CALL:',url,params,access_token);
    get_oauth1(url, {}, access_token, function(error, response, body) {
        if (!error && response.statusCode == 200) {
            var data = JSON.parse(body);
            callback(null, response, data);
        } else {
            callback(error, response, null);
        }
    }, client);
};

/*
 * set_push_hook()
 *
 * Set a push hook via the Stash API for the supplied repository.
 * Must have admin privileges for this to work.
 *
 * <reponame> is "<org or user>/<repo name>" e.g. "BeyondFog/Strider".
 * <url> is the URL for the webhook to post to.
 * <secret> is the Webhook secret, which will be used to generate the RSA-SHA1 header in the Stash request.
 * <token> OAuth1 access token
 * <callback> function(error)
 */
function createHooks(project, repo, url, secret, token, token_secret, callback) {
    var hook = url + "?owner=" + project + "&name=" + repo + "&branch=${refChange.name}&hash=${refChange.toHash}&message=${refChange.type}&author=${user.displayName}";
    var hook_key = "de.aeffle.stash.plugin.stash-http-get-post-receive-hook%3Ahttp-get-post-receive-hook";

    var hook_url = STASH_API_ENDPOINT + "/projects/" + project + "/repos/" + repo + "/settings/hooks/" + hook_key + "/settings";
    var enable_url = STASH_API_ENDPOINT + "/projects/" + project + "/repos/" + repo + "/settings/hooks/" + hook_key + "/enabled";

    console.debug('CREATE WEBHOOK URL:\n', hook_url, "\n", hook, "\n",
                  hook_key);
    var options = get_request_options(hook_url, null, {url: hook}, token,
                                      token_secret);
    request.put(options, function (err, response, data) {
        if (err) return callback(err);
        if (response.statusCode !== 200) {
            var badStatusErr = new Error('Bad status code: ' + response.statusCode);
            return callback(badStatusErr);
        }
        console.debug('ENABLE WEBHOOK URL:', enable_url);
        var options = get_request_options(enable_url, null, null, token,
                                          token_secret);
        request.put(options, function(err, response, data) {
            if (err) return callback(err);
            if (response.statusCode !== 200) {
                var badStatusErr = new Error('Bad status code: ' + response.statusCode);
                return callback(badStatusErr);
            }
            return callback(null, true);
        });
   });
}

/*
 * unset_push_hook()
 *
 * Delete push hook via the Stash API for the supplied repository.
 * Must have admin privileges for this to work.
 *
 * <reponame> is "<org or user>/<repo name>" e.g. "BeyondFog/Strider".
 * <url> The url to match
 * <token> OAuth1 access token
 * <callback> function(error, response, body)
 */
function deleteHooks(reponame, url, token, callback) {
    var apiUrl = STASH_API_ENDPOINT + "/repos/" + reponame + "/hooks";
    debug('Delete hooks for ' + reponame + ', identified by ' + url);
    superagent.get(apiUrl)
        .set('Authorization', 'token ' + token)
        .set('User-Agent', "StriderCD (http://stridercd.com)")
        .end(function (res) {
            if (res.status > 300) {
                debug('Error getting hooks', res.status, res.text);
                return callback(res.status);
            }
            var hooks = [];
            debug('All hooks:', res.body.length);
            res.body.forEach(function (hook) {
                if (hook.config.url !== url) return
                hooks.push(function (next) {
                    superagent.del(hook.url)
                        .set('Authorization', 'token ' + token)
                        .set('User-Agent', "StriderCD (http://stridercd.com)")
                        .end(function (res) {
                            if (res.status !== 204) {
                                console.log('bad status', res.status, hook.id, hook.url);
                                return next(new Error('Failed to delete a webhook: status for url ' + hook.url + ': ' + res.status));
                            }
                            next();
                        });
                });
            });
            debug('our hooks:', hooks.length);
            if (!hooks.length) return callback(null, false);
            async.parallel(hooks, function (err) {
                callback(err, true);
            });
        });
}

function getBranches(accessToken, owner, repo, done) {
    var path = "/repos/" + owner + "/" + repo + "/git/refs/heads";
    pageinated_api_call(path, accessToken, function(err, res) {
        var branches = [];
        if (res && res.data) {
            branches = res.data.map(function(h) {
                return h.ref.replace('refs/heads/', '');
            });
        }
        done(err, branches);
    });
}

function getFile(filename, ref, accessToken, owner, repo, done) {
    var uri = STASH_API_ENDPOINT + '/repos/' + owner + '/' + repo + '/contents/' + filename;
    var req = superagent.get(uri).set('User-Agent', "StriderCD (http://stridercd.com)");
    if (ref) {
        req = req.query({ref: ref});
    }
    if (accessToken) {
        req = req.set('Authorization', 'token ' + accessToken);
    }
    req.end(function (res) {
        if (res.error) return done(res.error, null);
        if (!res.body.content) {
            return done();
        }
        done(null, new Buffer(res.body.content, 'base64').toString());
    });
}

/*
 * getRepos()
 *
 * Fetch a list of all the repositories a given user has
 * "admin" privileges.
 *
 * <token> the stash oauth access token
 * <token_secret> the oauth access token secret
 * <callback> function(error, result-object)
 */
function getRepos(token, token_secret, callback) {
    // needs callback(null, {groupname: [repo, ...], ...})
    // see strider-extension-loader for details
    pageinated_api_call('/repos', token, token_secret, function(err, data) {
        if (err) {
            console.debug("getRepos(): Error: %s", err);
            return callback(err);
        }
        var repos = [];
        for (var i = 0; i < data.data.length; i++) {
            repos.push({
                id: data.data[i].id,
                name: data.data[i].project.key + "/" + data.data[i].name.toLowerCase(),
                display_name: data.data[i].name,
                group: data.data[i].project.key,
                display_url: apiURL + data.data[i].link.url,
                config: {
                    url: data.data[i].cloneUrl,
                    owner: data.data[i].project.key,
                    repo: data.data[i].name,
                    auth: {
                        type: 'https'
                    }
                }
            });
        }
        return callback(null, repos);
    });
}
