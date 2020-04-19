var express = require("express");
var app = express();
var SpotifyWebApi = require("spotify-web-api-node");
const { MongoClient } = require("mongodb");
const mongoURI =
  "mongodb+srv://dbUser:Jasper99!@playlistwatcherproject-tjrwu.gcp.mongodb.net/test?retryWrites=true&w=majority";

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
                    });
                    console.log("Inserted.");
                  }
                });
            }
          });
        },
        function (err) {
          console.log("Something went wrong!", err);
        }
      );
      res.render(__dirname + "/loginsuccess.ejs"); // automatically closes itself
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
  console.log("watchlistupdate spotify_user_uri: " + spotify_user_uri);
  GetUserWatchlist(spotify_user_uri, res);
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
      console.log(data);
      let playlist_name = data.body.name;
      let img_uri = data.body.images[0].url;
      let author = data.body;
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
          // TODO: result[0] is undefined when user first creates an account
          var dbPlaylists = result[0].playlists;
          var watchlist;
          if (dbPlaylists.length > 0) {
            watchlist = [];
            // Get the name and img url for each playlist uri
            for (let i = 0; i < dbPlaylists.length; i++) {
              let playlist = {};
              playlist.spotify_uri = dbPlaylists[i].spotify_uri;
              playlist.name = dbPlaylists[i].name;
              playlist.img_uri = dbPlaylists[i].img_uri;
              watchlist.push(playlist);
            }
          } else {
            watchlist = "empty";
          }
          console.log("Watchlist in GetUserWatchlist: " + watchlist);
          res.json(watchlist);
        });
    }
  });
}

module.exports = app;
