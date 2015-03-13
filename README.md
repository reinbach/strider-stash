strider-stash
==============

A provider for strider that integrates with Atlassian Stash to provide easy
setup of your projects. It registers webhooks and sets up ssh keys
(if you so choose).

## Setup

Your Stash instance will need have an [`Application Link`](https://confluence.atlassian.com/display/STASH/Stash+Documentation+Home) setup. You will also need to [create certificates](https://github.com/reinbach/passport-stash/tree/master/examples/login#setup-keys) to authenticate with.

The following information will be needed when setting up Stash on Strider-CD;

    - API URL to Stash instance. Generally ends in `http://<stash.domain.com>:7990`
    - `Consumer Key`
    - `PEM File location

## Credits

  - [Greg Reinbach](http://github.com/reinbach)

## License

[The MIT License](http://opensource.org/licenses/MIT)

Copyright (c) 2015 Greg Reinbach <[http://reinbach.com/](http://reinbach.com/)>
