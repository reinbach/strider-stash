'use strict';

var _ = require('lodash'),
    request = require('request'),
    fs = require('fs'),
    apiURL = process.env.STASH_API_URL || '',
    consumerKey = process.env.STASH_CONSUMER_KEY || '',
    consumerSecret = fs.readFileSync(process.env.STASH_PEM_FILE,
                                     {encoding: 'utf8'});

var STASH_API_ENDPOINT = apiURL + "/rest/api/1.0";
var HOOK_KEY = "de.aeffle.stash.plugin.stash-http-get-post-receive-hook%3Ahttp-get-post-receive-hook";

module.exports = {
    getRepos: getRepos,
    getFile: getFile,
    getBranches: getBranches,
    createHook: createHook,
    deleteHook: deleteHook
};

/*
 * get_oauth1()
 *
 * Do a HTTP GET w/ OAuth1 token
 * <url> URL to GET
 * <params> Object representing the query params to be added to GET request
 * <body> Object representing the query params to be added to body
 * <token> OAuth1 access token
 * <token_secret> OAuth1 access token secret
 */
var get_request_options = function(url, params, body, token, token_secret) {
    var oauth = {
        consumer_key: consumerKey,
        private_key: consumerSecret,
        token: token,
        token_secret: token_secret,
        signature_method: 'RSA-SHA1'
    };
    var options = {url: url, oauth: oauth, qs: params, json: true};
    if (body != undefined) {
        options.body = body;
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

function getHookEnabledURL(project, repo) {
    return STASH_API_ENDPOINT + "/projects/" + project + "/repos/" + repo + "/settings/hooks/" + HOOK_KEY + "/enabled";
}

/*
 * createHook()
 *
 * Set a push hook via the Stash API for the supplied repository.
 * Must have admin privileges for this to work.
 *
 * <project> is the Project name.
 * <repo> is the Repo name.
 * <url> is the URL for the webhook to post to.
 * <token> OAuth1 access token
 * <token_secret> OAuth1 access token secret
 * <callback> function(error)
 */
function createHook(project, repo, url, token, token_secret, callback) {
    var hook = url + "?owner=" + project + "&name=" + repo + "&branch=${refChange.name}&hash=${refChange.toHash}&message=${refChange.type}&author=${user.displayName}";

    var hook_url = STASH_API_ENDPOINT + "/projects/" + project + "/repos/" + repo + "/settings/hooks/" + HOOK_KEY + "/settings";
    var enable_url = getHookEnabledURL(project, repo);

    console.debug('CREATE HOOK:\n', hook_url, "\n", hook, "\n", HOOK_KEY);
    var options = get_request_options(hook_url, null, {url: hook}, token,
                                      token_secret);
    request.put(options, function (err, response, data) {
        if (err) return callback(err);
        if (response.statusCode !== 200) {
            var badStatusErr = new Error('Bad status code: ' + response.statusCode);
            return callback(badStatusErr);
        }
        console.debug('ENABLE HOOK:', enable_url);
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
 * deleteHook()
 *
 * Delete push hook via the Stash API for the supplied repository.
 * Must have admin privileges for this to work.
 *
 * <project> is the Project name.
 * <repo> is the Repo name.
 * <url> is the URL for the webhook to post to.
 * <token> OAuth1 access token
 * <token_secret> OAuth1 access token secret
 * <callback> function(error)
 */
function deleteHook(project, repo, url, token, token_secret, callback) {
    var delete_url = getHookEnabledURL(project, repo);
    console.debug('DELETE HOOK ' + url + ' for ' + project + '/' + repo);
    var options = get_request_options(delete_url, null, null, token,
                                      token_secret);
    request.del(options, function(err, response, data) {
        if (err) return callback(err);
        if (response.statusCode !== 200) {
            var badStatusErr = new Error('Bad status code: ' + response.statusCode);
            return callback(badStatusErr);
        }
        return callback(null, true);
    });
}

function getBranches(owner, repo, token, token_secret, done) {
    var url = "/projects/" + owner + "/repos/" + repo + "/branches";
    pageinated_api_call(url, token, token_secret, function(err, result) {
        if (err) return done(err);
        var branches = [];
        if (result && result.data) {
            branches = result.data.map(function(h) {
                return h.displayId;
            });
        }
        return done(err, branches);
    });
}

function getFile(filename, ref, token, token_secret, owner, repo, done) {
    var url = '/projects/' + owner + '/repos/' + repo + '/files/' + filename;
    pageinated_api_call(url, token, token_secret, function(err, result) {
        if (err) return done(err);
        if (!result.body.content) {
            return done();
        }
        return done(null, new Buffer(result.body.content,
                                     'base64').toString());
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
    pageinated_api_call('/repos', token, token_secret, function(err, result) {
        if (err) {
            console.debug("getRepos(): Error: %s", err);
            return callback(err);
        }
        var data = result.data;
        var repos = [];
        for (var i = 0; i < data.length; i++) {
            repos.push({
                id: data[i].id,
                name: data[i].project.key + "/" + data[i].name.toLowerCase(),
                display_name: data[i].name,
                group: data[i].project.key,
                display_url: apiURL + data[i].link.url,
                config: {
                    url: data[i].cloneUrl,
                    owner: data[i].project.key,
                    repo: data[i].name,
                    auth: {
                        type: 'http'
                    }
                }
            });
        }
        return callback(null, repos);
    });
}
