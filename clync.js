var clyncApp = angular.module('clyncApp', ['ngAnimate']);
(function(app) {

    // set up a directive to allow text inputs to accept when pressing enter
    app.directive('handleEnter', function () {
        return function ($scope, element, attrs) {
            element.bind('keydown keypress', function (event) {
                // 13 is "Enter"
                if (event.which === 13) {
                    $scope.$apply(function () {
                        $scope.$eval(attrs.handleEnter);
                    });

                    event.preventDefault();
                }
            });
        };
    });

    app.controller('ClyncController', function ClyncController($scope, $interval) {

        /***********************************************************************
        * util
        *
        * Utility methods
        ***********************************************************************/
        $scope.util = {
            /**
             * Creates a random username.
             *
             * @return {string} - A random username (anon###).
             */
            randomUsername: function() {
                return 'anon' + String(Math.floor(Math.random()*1000));
            },
        };

        /***********************************************************************
        * pubnub
        *
        * Pubnub wrapper.
        ***********************************************************************/
        $scope.pubnub = {
            channel: 'clync',
            instance: new PubNub({
                publishKey: 'pub-c-e5b53381-404c-44f3-944b-2fd9598cef7b',
                subscribeKey: 'sub-c-2f7c74a6-0c03-11e7-b34d-02ee2ddab7fe',
            }),
            /**
             * Intitializes the pubnub wrapper.
             */
            initialize: function() {
                var pubnub = this;

                pubnub.instance.subscribe({
                    channels: [pubnub.channel],
                    withPresence: true,
                });

            },
            /**
             * Publishes a message to the pubnub channel.
             */
            publish: function() {
                var pubnub = this;

                // We only allow one kind of message: the userID and username of
                // the publisher. Could be expanded in the future if more event
                // types are necessary.
                pubnub.instance.publish({
                    message: {
                        userID: $scope.user.ID,
                        username: $scope.user.name,
                    },
                    channel: pubnub.channel
                });
            },
            /**
             * Adds a listener to the pubnub channel with a given callback.
             *
             * @param {object} - Arguments object. Contains the required fields:
             *   @param {function} callback - The callback to be invoked when a
             *   message is heard.
             */
            subscribe: function(args) {
                var pubnub = this;

                pubnub.instance.addListener({
                    message: args.callback,
                });
            },
            /**
             * Adds a listener to the "state events" on the pubnub channel with
             * a given callback.
             *
             * @param {object} - Arguments object. Contains the required fields:
             *   @param {function} callback - The callback to be invoked when a
             *   state event is heard.
             */
            addStateListener: function(args) {
                var pubnub = this;
                pubnub.instance.addListener({
                    presence: function(presenceEvent) {
                        // This is a state listener, so only trigger for
                        // state-change events
                        if (presenceEvent.action === 'state-change') {
                            args.callback(presenceEvent);
                        }
                    },
                });
            },
            /**
             * Triggers a "state event" on the pubnub channel for the current
             * user with the given state.
             *
             * @param {object} - The state object to set.
             */
            setState: function(state) {
                var pubnub = this;

                pubnub.instance.setState({
                    state: state,
                    uuid: $scope.user.ID,
                    channels: [pubnub.channel],
                });
            },
            /**
             * Checks the number of devices on the pubnub channel and passes it
             * to the given callback.
             *
             * @param {object} - Arguments object. Contains the required fields:
             *   @param {function} callback - The callback to be invoked when
             *   the occupancy is known.
             */
            checkOccupancy: function(args) {
                var pubnub = this;

                pubnub.instance.hereNow(
                    {
                        channels: [pubnub.channel],
                    },
                    function (status, response) {
                        args.callback(response.totalOccupancy);
                    }
                );
            },
        };
        $scope.pubnub.initialize();

        /***********************************************************************
        * user
        *
        * The user object.
        ***********************************************************************/
        $scope.user = {
            ID: $scope.pubnub.instance.getUUID(),
            name: $scope.util.randomUsername(),
            score: 0,
            /**
             * Initialize the user object and set up subscriptions.
             *
             */
            initialize: function() {
                var user = this;

                $scope.pubnub.subscribe({
                    callback: function(message) {
                        // If the publisher is the current user then we don't
                        // handle the message.
                        if (message.publisher === user.ID) {
                            return;
                        }

                        // If the timer is running when you receive a message
                        // then you get points!
                        if ($scope.timer.isCountingDown()) {
                            user.addClync({
                                name: message.message.username,
                                points: Math.round(1000*$scope.timer.timeLeft),
                            });
                        }
                    },
                });
            },
            /**
             * Sets the user's score based on the given increment.
             *
             * @param {number} - The amount to increase the score by.
             */
            incrementScore: function(increment) {
                var user = this;

                // Add the increment, and round off to avoid floating point
                // issues.
                user.score = Math.round(user.score + increment);

                // The leaderboard messages can get lost or out of order. That's
                // not a big deal for others' scores, but we want to make sure
                // the leaderboard knows the current user's score accurately.
                $scope.leaderboard.setScore({
                    ID: user.ID,
                    name: user.name,
                    score: user.score,
                });

                // Publish the user's score as a state event so other users can
                // update leaderboards.
                $scope.pubnub.setState({
                    score: user.score,
                    username: user.name,
                });
            },
            /**
             * Adds a Clync to the user's list.
             *
             * @param {object} - The Clync to add. Must contain:
             *   @param {number} points - The number of points you got.
             *   @param {string} name   - The name who gave you the points.
             */
            addClync: function(clync) {
                var user = this;

                $scope.timer.noClyncs = false;

                // this is the active clync for one second
                user.activeClync = clync;
                user.hasActiveClync = true;
                $interval(function() {
                    if (user.activeClync === clync) {
                        user.hasActiveClync = false;
                    }
                }, 1000);

                user.incrementScore(clync.points);
            },
            /**
             * Sets the user's 1st, 2nd, or 3rd place tag
             */
            setTag: function() {
                var user = this;

                user.isFirst = false;
                user.isSecond = false;
                user.isThird = false;

                if (
                    $scope.leaderboard.third
                    && $scope.leaderboard.third.score === user.score
                ) {
                    user.isThird = true;
                }
                else if (
                    $scope.leaderboard.second
                    && $scope.leaderboard.second.score === user.score
                ) {
                    user.isSecond = true;
                }
                else if ($scope.leaderboard.first.score === user.score) {
                    user.isFirst = true;
                }
            },
        };
        $scope.user.initialize();

        /***********************************************************************
        * timer
        *
        * The countdown timer object.
        ***********************************************************************/
        $scope.timer = {
            /**
             * Initialize the timer object.
             */
            initialize: function() {
                var timer = this;

                timer.reset();
            },
            /**
             * Check if the timer is currently counting down.
             *
             * @return {boolean} - Whether or not timer is currently counting.
             */
            isCountingDown: function() {
                var timer = this;
                return timer._countingDown;
            },
            /**
             * Reset the timer to the initial state.
             */
            reset: function() {
                var timer = this;

                // If you got noClynCs you get a bonus 10k!
                if (timer.noClyncs) {
                    $scope.user.addClync({
                        points: 10000,
                    });
                }

                timer.timeLeft = 10;
                timer._countingDown = false;
                timer.noClyncs = true;
            },
            /**
             * Start counting down!
             */
            start: function() {
                var timer = this;

                // If we're already counting, just return.
                if (timer._countingDown) {
                    return;
                }

                timer._countingDown = true;

                // Every 100 milliseconds, decrement the time left. Do this 100
                // times to total 10 seconds.
                $interval(function() {
                    timer.timeLeft = (timer.timeLeft - .1).toFixed(1);

                    if (timer.timeLeft === '0.0') {
                        // At the end, reset the timer.
                        timer.reset();
                    }
                }, 100, 100);
            },
            /**
             * Handles a click of the timer. Starts counting down, and publishes
             * to give others points.
             */
            handleClick: function() {
                var timer = this;

                timer.start();
                $scope.pubnub.publish();
            },
        };
        $scope.timer.initialize();

        /***********************************************************************
        * leaderboard
        *
        * The leaderboard. Who's winning?!
        ***********************************************************************/
        $scope.leaderboard = {
            allScores: {},
            /**
             * Initialize the leaderboard. Set up a listener for "state events",
             * which is how score changes are tracked.
             */
            initialize: function() {
                var leaderboard = this;

                $scope.pubnub.addStateListener({
                    callback: function(event) {
                        if (event.uuid !== $scope.user.ID) {
                            leaderboard.setScore({
                                ID: event.uuid,
                                name: event.state.username,
                                score: event.state.score,
                            });
                        }
                    },
                });
            },
            /**
             * Sets a score.
             *
             * @param {object} - Arguments object. Contains the required fields:
             *   @param {string} ID    - The userID for the score being set.
             *   @param {string} name  - The username for the score being set.
             *   @param {string} score - The score being set.
             */
            setScore: function(args) {
                var leaderboard = this;

                leaderboard.allScores[args.ID] = {
                    name: args.name,
                    score: args.score,
                };

                // After setting a score, leaders may have changed.
                leaderboard.computeLeaders();
            },
            /**
             * Compute who the current leaders are.
             */
            computeLeaders: function() {
                var leaderboard = this;

                // grab the score data, and sort (reverse) by the score.
                var scoreData = _.values(leaderboard.allScores);
                var sortedScores = _.sortBy(scoreData, function(scoreDatum) {
                    return (-1) * (scoreDatum.score);
                });

                // grab the first three
                var leaders = _.first(sortedScores, 3);
                leaderboard.first = leaders[0];
                leaderboard.second = leaders[1];
                leaderboard.third = leaders[2];

                $scope.user.setTag();
            },
        };
        $scope.leaderboard.initialize();


        /***********************************************************************
        * modal
        *
        * Modals for the username entry and help screen
        ***********************************************************************/
        $scope.modal = {
            states: {
                user: 'is-active',
                rules: '',
            },
            _needsUsername: true,
            /**
             * Brings up the rules modal.
             */
            activateRules: function() {
                var modal = this;
                modal._activate({ type: 'rules' });

                // the rules modal can get called while the user modal is up
                // so dismiss it, but use _dismiss instead of dismissUser so
                // that _needsUsername remains true
                modal._dismiss({ type: 'user' });
            },
            /**
             * Brings up the user modal.
             */
            activateUser: function() {
                var modal = this;
                modal._activate({ type: 'user' });
            },
            /**
             * Dismisses the rules modal.
             */
            dismissRules: function() {
                var modal = this;

                if (modal._needsUsername) {
                    modal.activateUser();
                }

                modal._dismiss({ type: 'rules' });
            },
            /**
             * Dismisses the user modal.
             */
            dismissUser: function() {
                var modal = this;

                modal._needsUsername = false;
                modal._dismiss({ type: 'user' });
            },
            /**
             * Activates a modal.
             *
             * @param {object} - Arguments object. Contains the required fields:
             *   @param {function} type - The type of modal to activate.
             */
            _activate: function(args) {
                var modal = this;
                modal.states[args.type] = 'is-active';
            },
            /**
             * Dismisses a modal.
             *
             * @param {object} - Arguments object. Contains the required fields:
             *   @param {function} type - The type of modal to dismiss.
             */
            _dismiss: function(args) {
                var modal = this;
                modal.states[args.type] = '';
            },
        };

    });
})(clyncApp);
