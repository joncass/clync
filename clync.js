var clyncApp = angular.module('clyncApp', []);
(function(app) {

    app.directive('handleEnter', function () {
        return function ($scope, element, attrs) {
            element.bind('keydown keypress', function (event) {
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
        $scope.util = {
            roundToNearestTenth: function(num) {
                return Math.round(10*(num))/10
            },
            randomUsername: function() {
                return 'Anon' + String(Math.floor(Math.random()*1000));
            },
        };

        $scope.pubnub = {
            channel: 'clync',
            initialize: function() {
                var pubnub = this;

                pubnub.instance.subscribe({
                    channels: [pubnub.channel],
                    withPresence: true,
                });

            },
            instance: new PubNub({
                publishKey: 'pub-c-e5b53381-404c-44f3-944b-2fd9598cef7b',
                subscribeKey: 'sub-c-2f7c74a6-0c03-11e7-b34d-02ee2ddab7fe',
            }),
            publish: function() {
                var pubnub = this;

                pubnub.instance.publish({
                    message: {
                        userID: $scope.user.ID,
                        username: $scope.user.name,
                    },
                    channel: pubnub.channel
                });
            },
            subscribe: function(args) {
                var pubnub = this;

                pubnub.instance.addListener({
                    message: args.callback,
                });
            },
            addStateListener: function(args) {
                var pubnub = this;
                pubnub.instance.addListener({
                    presence: args.callback,
                });
            },
            addPresenceListener: function(args) {
                var pubnub = this;
                pubnub.instance.addListener({
                    presence: args.callback,
                });
            },
            setState: function(state) {
                var pubnub = this;

                pubnub.instance.setState({
                    state: state,
                    uuid: $scope.user.ID,
                    channels: [pubnub.channel],
                });
            },
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

        $scope.user = {
            ID: $scope.pubnub.instance.getUUID(),
            name: $scope.util.randomUsername(),
            score: 0,
            initialize: function() {
                var user = this;

                $scope.pubnub.subscribe({
                    callback: function(message) {
                        if (message.publisher === user.ID) {
                            return;
                        }

                        if ($scope.timer.isCountingDown()) {
                            user.addClync({
                                name: message.message.username,
                                points: Math.round(1000*$scope.timer.timeLeft),
                            });
                        }
                    },
                });
            },
            incrementScore: function(increment) {
                var user = this;

                user.score = $scope.util.roundToNearestTenth(user.score + increment);

                $scope.leaderboard.setScore({
                    ID: user.ID,
                    name: user.name,
                    score: user.score,
                });

                $scope.pubnub.setState({
                    score: user.score,
                    username: user.name,
                });
            },
            clyncs: [],
            addClync: function(clync) {
                var user = this;

                user.clyncs.unshift(clync);
                if (user.clyncs.length > 4) {
                    user.clyncs.pop();
                }

                $interval(function() {
                    var index = user.clyncs.indexOf(clync);
                    if (index > -1) {
                        user.clyncs.splice(index, 1);
                    }
                }, 2000);

                user.incrementScore(clync.points);
            },
            modal: {
                active: 'is-active',
                dismiss: function() {
                    var userModal = this;
                    userModal.active = '';
                },
            },
        };
        $scope.user.initialize();

        $scope.timer = {
            initialize: function() {
                var timer = this;

                timer.reset();
            },
            isCountingDown: function() {
                var timer = this;
                return timer._countingDown;
            },
            reset: function() {
                var timer = this;

                timer.timeLeft = 10;
                timer._countingDown = false;
            },
            start: function() {
                var timer = this;
                if (timer._countingDown) {
                    return;
                }

                timer._countingDown = true;

                $interval(function() {
                    timer.timeLeft = $scope.util.roundToNearestTenth(timer.timeLeft - .1);

                    if (!timer.timeLeft) {
                        timer.reset();
                    }
                }, 100, 100);
            },
            handleClick: function() {
                var timer = this;

                timer.start();
                $scope.pubnub.publish();
            },
        };
        $scope.timer.initialize();


        $scope.presence = {
            initialize: function() {
                var presence = this;

                var pubnub = $scope.pubnub;
                pubnub.addPresenceListener({
                    callback: presence.refreshOccupancy
                });
                presence.refreshOccupancy();

            },
            refreshOccupancy: function() {
                var presence = this;

                var pubnub = $scope.pubnub;
                pubnub.checkOccupancy({
                    callback: function(occupancy) {
                        presence.occupancy = occupancy;
                    },
                });
            },
            occupancy: '#',
        };
        $scope.presence.initialize();


        $scope.leaderboard = {
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
            allScores: {},
            setScore: function(args) {
                var leaderboard = this;

                leaderboard.allScores[args.ID] = {
                    name: args.name,
                    score: args.score,
                };

                leaderboard.computeLeaders();
            },
            computeLeaders: function() {
                var leaderboard = this;

                var scoreData = _.values(leaderboard.allScores);
                var sortedScores = _.sortBy(scoreData, function(scoreDatum) {
                    return (-1) * (scoreDatum.score);
                });

                leaderboard.leaders = _.first(sortedScores, 3);
            },
            leaders: [],
        };
        $scope.leaderboard.initialize();

    });
})(clyncApp);
