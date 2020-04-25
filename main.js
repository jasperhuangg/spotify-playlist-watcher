var express = require("express");
var app = express();
var SpotifyWebApi = require("spotify-web-api-node");
const { MongoClient } = require("mongodb");
const mongoURI =
  "mongodb+srv://dbUser:Jasper99!@playlistwatcherproject-tjrwu.gcp.mongodb.net/test?retryWrites=true&w=majority";
const { JSDOM } = require("jsdom");
const { window } = new JSDOM("");
const $ = require("jquery")(window);

app.use(express.urlencoded());
app.set("view engine", "ejs");

const port = 3000;

const clientID = "bac9fc1cdaaf4413adf86cbde1781d53";
const clientSecret = "8170841c8f2647768147e2134ef6a4d2";

app.listen(port, () => console.log("listening on port " + port));

// credentials are optional
var spotifyApi = new SpotifyWebApi({
  clientId: clientID,
  clientSecret: clientSecret,
  redirectUri: "http://localhost:3000/loginsuccess",
});

var scopes = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-private",
  "user-read-email",
  "user-modify-playback-state",
];

var authorizeURL = spotifyApi.createAuthorizeURL(scopes);

/* GET home page. */
app.get("/", function (req, res) {
  res.render(__dirname + "/login.ejs");
});

/* login requests */
app.get("/login", function (req, res) {
  res.redirect(authorizeURL); // new tab opens to authorizeURL
});

/* GET login success page, set auth token */
app.get("/loginsuccess/", function (req, res, next) {
  let code = req.query.code;
  spotifyApi.authorizationCodeGrant(code).then(
    function (data) {
      console.log("The token expires in " + data.body["expires_in"]);
      console.log("The access token is " + data.body["access_token"]);
      console.log("The refresh token is " + data.body["refresh_token"]);

      // Set the access token on the API object to use it in later calls
      spotifyApi.setAccessToken(data.body["access_token"]);
      spotifyApi.setRefreshToken(data.body["refresh_token"]);
      // Get the current user's Spotify Display Name/URI, add to database if not yet present
      spotifyApi.getMe().then(
        function (data) {
          let displayName = data.body.display_name;
          let spotifyURI = data.body.uri;

          app.locals.displayName = displayName;
          app.locals.spotifyURI = spotifyURI;

          // insert if user doesn't exist
          MongoClient.connect(mongoURI, function (err, db) {
            if (err) throw err;
            else {
              let collection = db
                .db("PlaylistWatcherUsers")
                .collection("PlaylistWatcherUsers");
              collection
                .find({ spotify_uri: spotifyURI })
                .toArray(function (err, result) {
                  if (err) console.error(err);
                  else if (result.length) {
                    console.log("User exists");
                    userExists = true;
                  } else {
                    console.log(
                      "User does not exist, inserting into database..."
                    );
                    collection.insertOne({
                      display_name: displayName,
                      spotify_uri: spotifyURI,
                      playlists: [],
                      activeDeviceIDs: [],
                      listeningQueue: [],
                    });
                    console.log("Inserted.");
                  }
                });
            }
          });

          // update devices for the current user
          spotifyApi.getMyDevices().then(
            function (result) {
              let devices = result.body.devices;
              let dbDevices = [];
              for (let i = 0; i < devices.length; i++) {
                device = {};
                device.id = devices[i].id;
                device.name = devices[i].name;
                dbDevices.push(device);
              }
              MongoClient.connect(mongoURI, function (err, db) {
                let collection = db
                  .db("PlaylistWatcherUsers")
                  .collection("PlaylistWatcherUsers");
                collection.findOneAndUpdate(
                  { spotify_uri: spotifyURI },
                  {
                    $set: {
                      activeDeviceIDs: dbDevices,
                    },
                  },
                  function (err, doc) {
                    if (err) console.error(err);
                    else console.log("Updated devices.");
                  }
                );
              });
            },
            function (err) {
              console.log(err);
            }
          );
          res.render(__dirname + "/loginsuccess.ejs"); // automatically closes itself
        },
        function (err) {
          console.log("Something went wrong!", err);
        }
      );
    },
    function (err) {
      console.log("Something went wrong!", err);
    }
  );
});

app.get("/watcher", function (req, res) {
  res.render(__dirname + "/watcher.ejs");
});

app.get("/watchlistupdate", function (req, res) {
  let spotify_user_uri = req.query.spotify_user_uri;
  GetUserWatchlist(spotify_user_uri, res);
});

app.get("/userdevices", function (req, res) {
  let spotify_user_uri = req.query.spotify_user_uri;
  GetUserDevices(spotify_user_uri, res);
});

// receive add playlist requests
app.post("/watcher", function (req, res) {
  console.log("User is trying to insert playlist with information: ");
  console.log("Playlist_URI: " + req.body.playlist_uri);
  console.log("User_URI: " + req.body.spotify_user_uri);

  let playlist_uri = req.body.playlist_uri;
  let spotify_user_uri = req.body.spotify_user_uri;

  spotifyApi.getPlaylist(playlist_uri.replace("spotify:playlist:", "")).then(
    function (data) {
      console.log("Valid Spotify playlist URI.");
      let playlist_name = data.body.name;
      let img_uri = data.body.images[0].url;
      let author = data.body.author;
      // check if playlist exists, if not insert
      MongoClient.connect(mongoURI, function (err, db) {
        if (err) throw err;
        else {
          let collection = db
            .db("PlaylistWatcherUsers")
            .collection("PlaylistWatcherUsers");
          collection
            .find({
              spotify_uri: spotify_user_uri,
              playlists: { $elemMatch: { spotify_uri: playlist_uri } },
            })
            .toArray(function (err, result) {
              if (result.length) {
                console.log("Playlist already exists.");
                res.send("Playlist already exists in your watchlist.");
              } else {
                collection.findOneAndUpdate(
                  { spotify_uri: spotify_user_uri },
                  {
                    $push: {
                      playlists: {
                        spotify_uri: playlist_uri,
                        name: playlist_name,
                        img_uri: img_uri,
                        tracks: [],
                      },
                    },
                  },
                  function (err, doc) {
                    if (err) console.error(err);
                    else console.log("Inserted playlist.");
                  }
                );
                res.send("Playlist inserted into your watchlist.");
              }
            });
        }
      });
    },
    function (err) {
      console.log("Invalid Spotify playlist URI.");
      res.send("Invalid Spotify playlist URI.");
    }
  );
});

// returns array of playlists in user's watchlist
async function GetUserWatchlist(user_uri, res) {
  MongoClient.connect(mongoURI, function (err, db) {
    if (err) throw err;
    else {
      let collection = db
        .db("PlaylistWatcherUsers")
        .collection("PlaylistWatcherUsers");
      collection
        .find({
          spotify_uri: user_uri,
        })
        .toArray(function (err, result) {
          var dbPlaylists = result[0].playlists;
          var watchlist;
          if (dbPlaylists.length > 0) {
            watchlist = [];
            // Get the name and img url for each playlist uri (maybe consider storing owner as well)
            for (let i = 0; i < dbPlaylists.length; i++) {
              let playlist = {};
              playlist.spotify_uri = dbPlaylists[i].spotify_uri;
              playlist.name = dbPlaylists[i].name;
              playlist.img_uri = dbPlaylists[i].img_uri;
              watchlist.push(playlist);
            }
            res.json(watchlist);
          } else {
            watchlist = "empty";
            res.send(watchlist);
          }
        });
    }
  });
}

function GetUserDevices(user_uri, res) {
  MongoClient.connect(mongoURI, function (err, db) {
    if (err) throw err;
    else {
      let collection = db
        .db("PlaylistWatcherUsers")
        .collection("PlaylistWatcherUsers");
      collection
        .find({
          spotify_uri: user_uri,
        })
        .toArray(function (err, result) {
          var dbDevices = result[0].activeDeviceIDs;
          var devices;
          if (dbDevices.length > 0) {
            devices = [];
            for (let i = 0; i < dbDevices.length; i++) {
              let device = {};
              device.id = dbDevices[i].id;
              device.name = dbDevices[i].name;
              devices.push(device);
            }
            res.json(devices);
          } else {
            devices = "empty";
            res.send(devices);
          }
          // console.log("Watchlist in GetUserWatchlist: " + watchlist);
        });
    }
  });
}

/* 
pings spotify server with userID to get current listening data 
pushes listening data to db
calculates listening statistics based on listening queue in db
removes necessary entries in listening queue from the db

TODO: will change to start listening on sign-in, 
match playlistID of current listening data to playlistIDs in watchlist
will make simplified version of playlist after listening data gathered for n tracks in a playlist
*/
//// probably need to use refresh token at some point
function UpdateTrackScores(userID) {
  console.log(
    "\n------------------------------------------------------------------------------------------------------------------------------------------------"
  );
  // hit get current playback endpoint, get track's spotify ID and context ID (playlist ID)
  spotifyApi.getMyCurrentPlaybackState().then(function (data) {
    let trackURI = data.body.item.uri;
    let trackName = data.body.item.name;
    let contextURI = data.body.context.uri;
    let isPlaying = data.body.is_playing;

    if (contextURI.search("user") != -1) {
      // improperly formatted contextURI
      // get everything from 'user' to right before 'playlist'
      let start = contextURI.search("user");
      let end = contextURI.search("playlist");
      toRemove = contextURI.substring(start, end);
      contextURI = contextURI.replace(toRemove, "");
    }

    if (isPlaying) {
      console.log(
        "User is listening to " +
          trackName +
          " at " +
          trackURI +
          " in " +
          contextURI
      );
      // check if song exists in playlist for that user, if not then add it (with an initial score of 1000)
      MongoClient.connect(mongoURI, function (err, db) {
        if (err) throw err;
        else {
          let collection = db
            .db("PlaylistWatcherUsers")
            .collection("PlaylistWatcherUsers");
          // first check if user is listening to a playlist in their watchlist, if not then don't do anything
          collection
            .find({
              spotify_uri: userID,
              playlists: { $elemMatch: { spotify_uri: contextURI } },
            })
            .toArray(function (err, result) {
              if (result.length) {
                console.log("-->Playlist in watchlist.");
                collection
                  .find({
                    spotify_uri: userID,
                    "playlists.tracks": {
                      $elemMatch: { spotify_uri: trackURI },
                    },
                  })
                  .toArray(function (err, result) {
                    if (result.length) {
                      console.log("-->Track exists in provided context URI.");
                    } else {
                      console.log(
                        "-->Track does not exist in context, inserting..."
                      );
                      collection.findOneAndUpdate(
                        {
                          spotify_uri: userID,
                          playlists: {
                            $elemMatch: { spotify_uri: contextURI },
                          },
                        },
                        {
                          $push: {
                            "playlists.$.tracks": {
                              spotify_uri: trackURI,
                              name: trackName,
                              score: 1000,
                            },
                          },
                        },
                        function (err, doc) {
                          if (err) console.error(err);
                        }
                      );
                    }
                  });
              } else {
                console.log("Playlist not in watchlist");
              }
            });
        }
      });
      // if queue is empty: add song to queue
      // if queue is not empty: compare song in queue to current playback song
      //// if song differs: iterate through all entries in queue, calculate score to increment/decrement based on listening behavior, pop everything off the queue
      //// push query onto the queue
    } else {
      console.log("Playback is paused.");
    }
  });

  // check if song for entry differs from last entry in queue
  // if song differs: (
  //// iterate thru all entries in queue, calculate score to increment/decrement based on listening behavior (time)
  /* SCORING: (time = num entries for old song * 10)
      - time <= max(10 seconds or 10% of track length): -70
      - max(15 seconds or 10% of track length) < time <= 25% of track length: -30
      - 25% of track length < time <= 45% of track length: -10
      - 45% of track length < time <= 65% of track length: +20
      - 65% of track length < time <= 85% of track length: +30
      - 85% of track length < time <= 100% of track length: +70
      */
  //// update the track's score in db for userID
  //// pop everything off the queue )
  // insert new entry into user's listening queue
  // return
}

app.post("/start-watching", function (req, res) {
  let playlist_uri = req.body.playlist_uri;
  let user_uri = req.body.spotify_user_uri;

  // clear the user's listening queue
  MongoClient.connect(mongoURI, function (err, db) {
    let collection = db
      .db("PlaylistWatcherUsers")
      .collection("PlaylistWatcherUsers");
    collection.findOneAndUpdate(
      { spotify_uri: spotifyURI },
      {
        $set: {
          listeningQueue: [],
        },
      },
      function (err, doc) {
        if (err) console.error(err);
        else console.log("Cleared listening queue.");
      }
    );
  });

  UpdateTrackScores(user_uri);
  var interval = setInterval(UpdateTrackScores, 10000, user_uri); // does listening stat calculations every 10 seconds

  // MongoClient.connect(mongoURI, function (err, db) {
  //   if (err) throw err;
  //   else {
  //     let collection = db
  //       .db("PlaylistWatcherUsers")
  //       .collection("PlaylistWatcherUsers");
  //     collection
  //       .find({ spotify_uri: user_uri })
  //       .toArray(function (err, result) {
  //         if (err) console.error(err);
  //         else if (result.length) {
  //           let device_id = result[0].activeDeviceIDs[0].id;

  //           // transfer playback to that device_id (make it active)
  //           $.ajax({
  //             headers: {
  //               Authorization: "Bearer " + spotifyApi.getAccessToken(),
  //               Accept: "application/json",
  //               "Content-Type": "application/json",
  //             },
  //             url: "https://api.spotify.com/v1/me/player",
  //             type: "PUT",
  //             data: JSON.stringify({ device_ids: [device_id] }),
  //           });

  //           // start playing the requested playlist on device with device_id:
  //           $.ajax({
  //             headers: {
  //               Authorization: "Bearer " + spotifyApi.getAccessToken(),
  //               Accept: "application/json",
  //               "Content-Type": "application/json",
  //             },
  //             url:
  //               "https://api.spotify.com/v1/me/player/play?device_id=" +
  //               device_id,
  //             type: "PUT",
  //             data: JSON.stringify({ context_uri: playlist_uri }),
  //           });
  //         }
  //       });
  //   }
  // });
  app.post("/stop-watching", function (req, res) {
    // TODO: clear user's recent tracks queue in db
    console.log("received stop watching");
    clearInterval(interval);
    // stop user playback:
    $.ajax({
      headers: {
        Authorization: "Bearer " + spotifyApi.getAccessToken(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      url: "https://api.spotify.com/v1/me/player/pause",
      type: "PUT",
    });
  });
});

module.exports = app;
