import express from "express";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  deleteUser,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  collection,
  writeBatch,
    updateDoc
} from "firebase/firestore";
import "../db/firebase.mjs";
import jwt from "jsonwebtoken";
import secretKey from "./secretKey.js";

const auth = getAuth();
const db = getFirestore();
const app = express.Router();

app.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const lowercaseUsername = username.toLowerCase();

    const userDoc = await getDocs(collection(db, "users"));
    let usernameExists = false;

    userDoc.forEach((doc) => {
      if (doc.data().username === lowercaseUsername) {
        usernameExists = true;
      }
    });

    if (usernameExists) {
      console.log("Username already exists");
      res.status(401).send({ error: "Username already exists" });
    } else {
      try {
        createUserWithEmailAndPassword(auth, email, password)
          .then(async (userRecord) => {
            console.log("Successfully created new user:", userRecord.user.uid);

            const userDoc = doc(db, "users", lowercaseUsername);
            const emailToUsernameDoc = doc(db, "emailToUsername", email);

            const batch = writeBatch(db);

            // Retrieve the levels for each movie and add them to the themes object
            const moviesRef = collection(db, "movies");
            const moviesSnapshot = await getDocs(moviesRef);
            const themes = {};

            for (const movieDoc of moviesSnapshot.docs) {
              const movieName = movieDoc.id;
              const levelsRef = collection(db, "movies", movieName, "levels");
              const levelsSnapshot = await getDocs(levelsRef);
              const levels = {};

              let firstLevel = true;
              levelsSnapshot.forEach((levelDoc) => {
                if (firstLevel) {
                  levels[levelDoc.id] = true;
                  firstLevel = false;
                } else {
                  levels[levelDoc.id] = false;
                }
              });

              themes[movieName] = { levels: levels };
            }

            batch.set(userDoc, {
              username: lowercaseUsername,
              email: email,
              userid: userRecord.user.uid,
              following: [],
              followers: [],
              avatar: `https://api.dicebear.com/6.x/adventurer-neutral/svg?seed=${lowercaseUsername}`,
              bestwpm: 0,
              avgwpm: 0,
              gamesplayed: 0,
              bosses: 0,
              themescompleted: 0,
              lastplayed: [],
              themes: themes,
            });

            batch.set(emailToUsernameDoc, {
              username: lowercaseUsername,
            });

            console.log("User data stored in Firestore");

            const payload = {
              uid: userRecord.user.uid,
              username: lowercaseUsername,
              email: email,
            };

            const token = jwt.sign(payload, secretKey, {
              expiresIn: "336h",
            });

            res.status(200).send({ token: token, uid: userRecord.user.uid });

            return batch.commit();
          })
          .catch((error) => {
            console.log("Error creating new user:", error);
            res.status(500).send({ error: error.message });
          });
      } catch (e) {
        res.status(500).send({ error: e.message });
      }
    }
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

app.post("/login", async (req, res) => {
    const { identifier, password } = req.body;
    const lowercaseIdentifier = identifier.toLowerCase();

    // First, attempt to find the user by username.
    const userDoc = await getDocs(collection(db, "users"));
    let email;

    userDoc.forEach((doc) => {
        if (doc.data().username === lowercaseIdentifier) {
            email = doc.data().email;
        }
    });

    const completeUserParameters = async (user) => {
        // List of user parameters that should exist.
        const parameters = [
            "username",
            "email",
            "userid",
            "following",
            "followers",
            "avatar",
            "bestwpm",
            "avgwpm",
            "gamesplayed",
            "bosses",
            "themescompleted",
            "lastplayed",
            "themes",
        ];

        const userDoc = doc(db, "users", lowercaseIdentifier);

        const userData = (await getDoc(userDoc)).data() || {};
        const missingParameters = parameters.filter((param) => !(param in userData));

        if (missingParameters.length > 0) {
            // If there are any missing parameters, create them with default values.
            const updates = {};
            for (const param of missingParameters) {
                switch (param) {
                    case "following":
                    case "followers":
                    case "lastplayed":
                        updates[param] = [];
                        break;
                    case "avatar":
                        updates[param] = `https://api.dicebear.com/6.x/adventurer-neutral/svg?seed=${lowercaseIdentifier}`;
                        break;
                    case "username":
                        updates[param] = lowercaseIdentifier;
                        break;
                    case "email":
                        updates[param] = email;
                        break;
                    case "userid":
                        updates[param] = user.uid;
                        break;
                    default:
                        updates[param] = 0;
                }
            }

            await updateDoc(userDoc, updates);
        }

        // Check if all movies exist in the user's data.
        const moviesRef = collection(db, "movies");
        const moviesSnapshot = await getDocs(moviesRef);

        for (const movieDoc of moviesSnapshot.docs) {
            const movieName = movieDoc.id;
            if (!userData.themes || !(movieName in userData.themes)) {
                // If the movie doesn't exist in the user's data, add it.
                const levelsRef = collection(db, "movies", movieName, "levels");
                const levelsSnapshot = await getDocs(levelsRef);
                const levels = {};

                let firstLevel = true;
                levelsSnapshot.forEach((levelDoc) => {
                    if (firstLevel) {
                        levels[levelDoc.id] = true;
                        firstLevel = false;
                    } else {
                        levels[levelDoc.id] = false;
                    }
                });

                const updates = {
                    [`themes.${movieName}`]: { levels: levels },
                };

                await updateDoc(userDoc, updates);
            }
        }
    };


    const signInUser = (email, password, identifier) => {
        signInWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                console.log("User logged in successfully");

                completeUserParameters(userCredential.user).catch((error) => {
                    console.error("Error completing user parameters:", error);
                    res.status(500).send({ error: error.message });
                });

                const payload = {
                    uid: userCredential.user.uid,
                    username: identifier,
                    email: email,
                };

                const token = jwt.sign(payload, secretKey, { expiresIn: "336h" });

                res
                    .status(200)
                    .send({ token: token, username: userCredential.user.uid });
            })
            .catch((error) => {
                console.error("Error:", error.message);
                console.error(email, password);
                res.status(400).send({ error: error.message });
            });
    };

    if (email) {
        // User found by username, attempt to sign in with their email.
        signInUser(email, password, lowercaseIdentifier);
    } else {
        // User not found by username, attempt to sign in with the identifier as email.
        signInWithEmailAndPassword(auth, lowercaseIdentifier, password)
            .then((userCredential) => {
                console.log("User logged in successfully");

                // Get the username corresponding to this email.
                getDoc(doc(db, "emailToUsername", lowercaseIdentifier))
                    .then((docSnapshot) => {
                        if (docSnapshot.exists()) {
                            const username = docSnapshot.data().username;

                            completeUserParameters(userCredential.user).catch((error) => {
                                console.error("Error completing user parameters:", error);
                                res.status(500).send({ error: error.message });
                            });

                            const payload = {
                                uid: userCredential.user.uid,
                                username: username,
                                email: lowercaseIdentifier,
                            };

                            const token = jwt.sign(payload, secretKey, { expiresIn: "336h" });

                            res.status(200).send({ token: token, username: username });
                        } else {
                            // Handle the case where no username was found for this email.
                            // This should ideally never happen if your signup code is working correctly.
                        }
                    })
                    .catch((error) => {
                        console.error("Error getting username from email:", error);
                        res.status(500).send({ error: error.message });
                    });
            })
            .catch((error) => {
                console.error("Error:", error.message);
                console.error(lowercaseIdentifier, password);
                res.status(400).send({ error: error.message });
            });
    }
});


app.post("/validate", async (req, res) => {
  const token = req.body.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, secretKey);
      res.status(200).send({ valid: true, username: decoded.username });
    } catch (e) {
      res.status(401).send({ valid: false, error: e.message });
    }
  } else {
    res.status(400).send({ valid: false, error: "No token provided" });
  }
});

export default app;