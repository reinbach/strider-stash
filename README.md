strider-stash
==============

A provider for strider that integrates with Atlassian Stash to provide easy
setup of your projects. It registers webhooks and sets up ssh keys
(if you so choose).

## Setup

### Stash

The following will need to be done on your Stash instance;

   * [create certificates](https://github.com/reinbach/passport-stash/tree/master/examples/login#setup-keys) to authenticate with Stash.
   * [Application Link](https://confluence.atlassian.com/display/STASH/Stash+Documentation+Home) setup.
   * Install `HTTP Request Post-Receive Hook for Stash` add on

### Environment Variables

Setup the following environment variables for Strider-CD;

    $ export STASH_API_URL=http://localhost:7990
    $ export STASH_CONSUMER_KEY=<consumer-key>
    $ export STASH_PEM_FILE=</path/to/pem/file>


## Credits

  - [Greg Reinbach](http://github.com/reinbach)

## License

[The MIT License](http://opensource.org/licenses/MIT)

Copyright (c) 2015 Greg Reinbach <[http://reinbach.com/](http://reinbach.com/)>
