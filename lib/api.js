var _ = require('lodash'),
    request = require('request'),
    superagent = require('superagent'),
    Step = require('step'),
    qs = require('querystring'),
    fs = require('fs'),
    url = require('url'),
    async = require('async'),
    debug = require('debug')('strider-stash:api'),
    apiURL = process.env.STASH_API_URL || '',
    consumerKey = process.env.STASH_CONSUMER_KEY || '',
    consumerSecret = fs.readFileSync(process.env.STASH_PEM_FILE,
                                     {encoding: 'utf8'});

var STASH_API_ENDPOINT = apiURL + "/rest/api/1.0";

module.exports = {
    getRepos: getRepos,
    getFile: getFile,
    getBranches: getBranches,
    createHooks: createHooks,
    deleteHooks: deleteHooks
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
function createHooks(reponame, url, secret, token, callback) {
    var qpm = {access_token: token};
    var post_url = STASH_API_ENDPOINT + "/repos/" + reponame + "/hooks?" + qs.stringify(qpm);
    debug('CREATE WEBHOOK URL:',post_url,url);
    request.post({
        url:post_url,
        body: {
            name: "web",
            active: true,
            events: ['push', 'pull_request', 'issue_comment'],
            config: {
                url: url,
                secret: secret
            }
        },
        json: true,
        headers:{
            "user-agent":"StriderCD (http://stridercd.com)"
        }
    }, function (err, response, body) {
        if (err) return callback(err);
        if (response.statusCode !== 201) {
            var badStatusErr = new Error('Bad status code: ' + response.statusCode);
            badStatusErr.statusCode = response.statusCode;
            return callback(badStatusErr);
        }
        callback(null, true);
    });
}

/*
 * unset_push_hook()
 *
 * Delete push hook via the Github API for the supplied repository.
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
 * get_oauth1()
 *
 * Do a HTTP GET w/ OAuth1 token
 * <url> URL to GET
 * <q_params> Object representing the query params to be added to GET request
 * <access_token> OAuth1 access token
 * <callback> function(error, response, body)
 */
var get_oauth1 = exports.get_oauth1 = function(url, q_params, access_token, callback, client) {
    client = client || request;
    url += "?";
    q_params.access_token = access_token;
    url += qs.stringify(q_params);
    console.log('GET OAUTH1 URL:', url);
    client.get({url:url,
                headers:{"user-agent": "StriderCD (http://stridercd.com)"}},
               callback);
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
 * parse_link_header()
 *
 * Parse the Stash Link HTTP header used for pageination
 * http://developer.github.com/v3/#pagination
 */
var parse_link_header = exports.parse_link_header = function parse_link_header(header) {
    if (header.length === 0) {
        throw new Error("input must not be of zero length");
    }

    // Split parts by comma
    var parts = header.split(',');
    var links = {};
    // Parse each part into a named link
    _.each(parts, function(p) {
        var section = p.split(';');
        if (section.length != 2) {
            throw new Error("section could not be split on ';'");
        }
        var url = section[0].replace(/<(.*)>/, '$1').trim();
        var name = section[1].replace(/rel="(.*)"/, '$1').trim();
        links[name] = url;
    });

    return links;
};


/*
 * pageinated_api_call()
 *
 * Simple HTTP Get Stash API wrapper with support for pageination via
 * Link header.
 * See: http://developer.github.com/v3/#pagination
 *
 * <path> API call URL path
 * <access_token> Oauth1 access token
 * <callback> function(error, response, de-serialized json)
 *
 */
var pageinated_api_call = exports.pageinated_api_call = function(path, access_token, callback, client) {
    client = client || request;
    var base_url = STASH_API_ENDPOINT + path;

    if (!access_token){
        console.error("Error in request - no access token");
        console.trace();
    }

    // This is a left fold,
    // a recursive function closed over an accumulator

    var pages = [];

    function loop(uri, page) {
        console.debug('PAGINATED API CALL URL:', uri);
        get_oauth1(uri, {limit:30, start:page}, access_token, function(error, response, body) {
            //test
            console.log(body);
            if (!error && response.statusCode == 200) {
                var data;
                try {
                    data = JSON.parse(body);
                } catch (e) {
                    return callback(e, null);
                }
                //test
                console.log(data);
                pages.push(data);

                var link = response.headers['link'];
                var r;
                if (link) {
                    r = parse_link_header(link);
                }
                // Stop condition: No link header or we think we just read the last page
                if (!link || r.next === undefined) {
                    callback(null, {data:_.flatten(pages), response: response});
                } else {
                    // Request next page and continue
                    var next_page = url.parse(r.next, true).query.page;
                    loop(base_url, next_page);
                }
            } else {
                if (!error){
                    if (response.statusCode === 401 || response.statusCode === 403) {
                        return callback(new Error('Github app is not authorized. Did you revoke access?'));
                    }
                    return callback(new Error("Status code is " + response.statusCode + " not 200. Body: " + body));
                } else {
                    return callback(error, null);
                }
            }
        }, client);
    }

    // Start from page 0
    loop(base_url, 0);
};

/*
 * get_stash_repos()
 *
 * Fetch a list of all the repositories a given user has
 * "admin" privileges. Because of the structure of the Stash API,
 * this can require many separate HTTP requests. We attempt to
 * parallelize as many of these as we can to do this as quickly as possible.
 *
 * <token> the stash oauth access token
 * <username> the stash username
 * <callback> function(error, result-object)
 */
function getRepos(token, username, callback) {
    var org_memberships = [];
    var team_repos = [];
    var repos = [];
    // needs callback(null, {groupname: [repo, ...], ...})
    // see strider-extension-loader for details

    Step(
        function fetchRepos() {
            pageinated_api_call('/repos', token, this.parallel());
        },
        // Reduce all the results and call output callback.
        function finalize(err, results) {
            if (err) {
                console.debug("get_stash_repos(): Error with team repos request: %s", err);
                return callback(err);
            }
            _.each(results, function(result) {
                if (result && result.data) {
                    _.each(result.data, function(team_repo) {
                        team_repos.push({
                            id: team_repo.id,
                            display_url: team_repo.html_url,
                            name: team_repo.full_name.toLowerCase(),
                            display_name: team_repo.full_name,
                            group: team_repo.owner.login,
                            config: {
                                url: "git://" + team_repo.clone_url.split('//')[1],
                                owner: team_repo.owner.login,
                                repo: team_repo.name,
                                auth: {
                                    type: 'https'
                                }
                            }
                        });
                    });
                }
            });
            // Sometimes we can get multiple copies of the same team repo, so we uniq it
            team_repos = _.uniq(team_repos, false, function(item) {
                return item.id;
            });

            callback(null, repos.concat(team_repos));
        }
    );
}
