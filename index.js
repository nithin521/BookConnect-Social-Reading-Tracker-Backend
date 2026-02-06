const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = express();

const bcrypt = require("bcrypt");
const saltRound = 10;
const cookieParser = require("cookie-parser");
const session = require("express-session");
const mysql = require("mysql2");

const { getUserBooks, insertData } = require("./Files/getUserBooks");

require("dotenv").config();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
// app.use(
//   cors({
//     origin: ["https://bookconnecttracker.netlify.app"], //You can change this frontend Link
//     methods: ["GET", "POST", "DELETE", "PUT"],
//     credentials: true,
//   })
// );
app.use(
  cors({
    origin: "https://bookdiscover.netlify.app",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
//development
// app.use((req, res, next) => {
//   res.header("Access-Control-Allow-Origin", "https://bookdiscover.netlify.app"); // Replace with your actual frontend URL
//   res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE"); // Allow specific methods
//   res.header("Access-Control-Allow-Headers", "Content-Type, Authorization"); // Allow specific headers
//   res.header("Access-Control-Allow-Credentials", "true");
//   next();
// });
//Creation of session
app.use(
  session({
    key: "userId",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      expires: 60 * 60 * 24 * 500, //half day
      httpOnly: true,
      secure: true,
      sameSite: "none",
    },
  }),
);

function copyQuery(query) {
  return new Promise((resolve, reject) => {
    const connection = mysql.createConnection(
      process.env.MYSQL_CONNECTION_STRING,
    );
    connection.query(query, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
    connection.end();
  });
}

function copyExecute(setting) {
  return new Promise((resolve, reject) => {
    const connection = mysql.createConnection(
      process.env.MYSQL_CONNECTION_STRING,
    );
    let { first, second, sql } = setting;
    if (first && second) {
      connection.execute(sql, [first, second], (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    } else if (first && !second) {
      connection.execute(sql, [first], (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve(response);
        }
      });
    } else {
      resolve({});
    }
    connection.end();
  });
}

//Add user to database
app.post("/addUser", (req, res) => {
  const { img, user, pass } = req.body;
  bcrypt.hash(pass, saltRound, async (err, hash) => {
    if (err) throw err;
    await copyQuery(
      `insert into user(username,pass,profile_pic) values('${user}','${hash}','${img}')`,
    );
    res.status(200).send("Success");
  });
});

//Validating User
app.post("/signIn/user", async (req, res) => {
  let userName = req.body.userName;
  let password = req.body.password;
  let data = await copyQuery(
    `select * from user where username='${userName}';`,
  );
  if (data.length > 0) {
    bcrypt.compare(password, data[0].pass, (err, response) => {
      //Decrypting Password
      if (err) throw err;
      else {
        req.session.user = data; //Creating a Session
        res.status(200).json(data);
      }
    });
  } else {
    req.session.user = null;
    res.json("error");
  }
});

app.get("/", getUserBooks);

//Get all users from DB
app.get("/getUsers", async (req, res) => {
  let response = await copyQuery("select * from user");
  res.json(response);
});

//Books Searching
app.post("/", async (req, res) => {
  const input = req.body.input;
  console.log(input);
  let result;
  let response = await copyQuery(
    `select * from books where title like '%${input}%' or author like '%${input}%'`,
  );
  if (response.length < 4) {
    result = await insertData(input);
    let newArr = [...response, ...result];

    res.json(newArr);
  } else {
    res.json(response);
  }
});

//Genre Specific Books
app.post("/genre/:genreid", async (req, res) => {
  let genre_name = req.params.genreid;
  let response = await copyQuery(
    ` select * from books b join genres g on b.genre_id=g.genre_id where g.genre_name="${genre_name}";`,
  );
  res.status(200).json(response);
});

//Get specific user
app.get("/getUsers/:userInput/:currUser", async (req, res) => {
  let userSearch = req.params.userInput;
  let currUser = req.params.currUser;
  let usersOnSearch = await copyQuery(
    `select * from user where (username like '%${userSearch}%') `,
  );
  let tempFriends = await copyExecute({
    sql: `select * from user join friend_requests on user.userId=friend_requests.sender_id where  friend_requests.sender_id=?;`,
    first: currUser,
  });
  res.status(200).json({ usersOnSearch, tempFriends });
});

app.get("/signIn/user", async (req, res) => {
  if (req.session && req.session.user) {
    res.send({ LoggedIn: true, user: req.session.user });
  } else {
    res.send({ LoggedIn: false });
  }
});

//Logout
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) res.status(500).json({ message: "Logout failed" });
    else {
      res.clearCookie("userId"); // Clear the session cookie
      res.status(200).json({ message: "Logout successful" });
    }
  });
});

// test method
app.get("/test-insert", async (req, res) => {
  await insertData("harry potter");
  res.send("Inserted");
});


//Adding Book to a Shelf
app.post("/userPreference", async (req, res) => {
  try {
    const { user, value: shelf, bookId } = req.body;
    let data = await copyExecute({
      sql: `select * from ${shelf} where userId=? and bookId=?`,
      first: user,
      second: bookId,
    });
    if (data.length === 0) {
      await copyExecute({
        sql: `insert into ${shelf} (bookId,userId) values(?,?) `,
        first: bookId,
        second: user,
      });
    }
    res.status(200).send("Success");
  } catch (error) {
    console.error("Error in /userPreference:", error);
    res.status(500).send("Internal Server Error");
  }
});

//Deleting a book From a Shelf
app.delete("/deletepreferences/:userId/:pref/:bookId", async (req, res) => {
  try {
    const { userId, pref, bookId } = req.params;
    copyExecute({
      sql: `delete from ${pref} where userId=? and bookId=?`,
      first: userId,
      second: bookId,
    });
    res.status(200).send("Success");
  } catch (error) {
    console.error("Error in /deletepreferences:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/getPreferences/:userId/:pref/:bookId", async (req, res) => {
  const { userId, pref, bookId } = req.params;
  let data = await copyQuery(
    `select * from ${pref} where userId=${userId} and bookId=${bookId}`,
  );
  res.status(200).json(data[0]);
});

//Get all books added to a particular Shelf
app.get("/getLibrary/:table/:userId", async (req, res) => {
  const { table, userId } = req.params;
  let response = await copyExecute({
    sql: `SELECT * FROM ${table} c join books b on b.book_id=c.bookId and c.userId=? order by created_at desc`,
    first: userId,
  });
  res.status(200).json(response);
});

//Get Friends Library
app.get("/getFriendsLibrary/:table/:userId", async (req, res) => {
  const { table, userId } = req.params;
  console.log(table, userId);
  let response = await copyExecute({
    sql: `SELECT * FROM books c join ${table} b on b.bookId=c.book_id and b.userId=? order by created_at desc`,
    first: userId,
  });
  res.status(200).json(response);
});

// Enhanced book search with filters and sorting (NO reviews)
app.post("/api/books/search", async (req, res) => {
  try {
    const {
      query = "",
      genre = "all",
      author = "all",
      minRating = "",
      maxRating = "",
      minPages = "",
      maxPages = "",
      minYear = "",
      maxYear = "",
      sortBy = "rating-high",
      page = 1,
      limit = 12,
    } = req.body;

    // 🔑 Phase 1: Check if DB has ANY books for the search query
    if (query) {
      const seedCheckResult = await copyExecute({
        sql: `
    SELECT COUNT(*) AS total
    FROM books
    WHERE title LIKE ? OR author LIKE ?
  `,
        first: `%${query}%`,
        second: `%${query}%`,
      });

      // ❌ DB empty for this query → fetch from API
      if (seedCheckResult[0].total <= 4) {
        console.log("DB empty for query, seeding from API:", query);
        await insertData(query);
      }
    }

    let whereConditions = [];

    // Search query
    if (query) {
      whereConditions.push(
        `(b.title LIKE '%${query}%' OR b.author LIKE '%${query}%')`,
      );
    }

    // Genre filter
    if (genre !== "all") {
      whereConditions.push(`g.genre_name = '${genre}'`);
    }

    // Author filter
    if (author !== "all") {
      whereConditions.push(`b.author = '${author}'`);
    }

    // Rating range
    if (minRating) whereConditions.push(`b.rating >= ${Number(minRating)}`);
    if (maxRating) whereConditions.push(`b.rating <= ${Number(maxRating)}`);

    // Page count range
    if (minPages) whereConditions.push(`b.pageCount >= ${Number(minPages)}`);
    if (maxPages) whereConditions.push(`b.pageCount <= ${Number(maxPages)}`);

    // Publication year range
    if (minYear)
      whereConditions.push(`YEAR(b.published_date) >= ${Number(minYear)}`);
    if (maxYear)
      whereConditions.push(`YEAR(b.published_date) <= ${Number(maxYear)}`);

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // Sorting
    let orderByClause = "ORDER BY b.rating DESC";
    switch (sortBy) {
      case "rating-low":
        orderByClause = "ORDER BY b.rating ASC";
        break;
      case "newest":
        orderByClause = "ORDER BY b.published_date DESC";
        break;
      case "oldest":
        orderByClause = "ORDER BY b.published_date ASC";
        break;
      case "alphabetical-asc":
        orderByClause = "ORDER BY b.title ASC";
        break;
      case "alphabetical-desc":
        orderByClause = "ORDER BY b.title DESC";
        break;
      case "pages-high":
        orderByClause = "ORDER BY b.pageCount DESC";
        break;
      case "pages-low":
        orderByClause = "ORDER BY b.pageCount ASC";
        break;
    }

    // Count query
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM books b
      LEFT JOIN genres g ON b.genre_id = g.genre_id
      ${whereClause}
    `;

    const countResult = await copyQuery(countQuery);
    const totalBooks = countResult[0].total;

    // Pagination
    const offset = (Number(page) - 1) * Number(limit);

    const dataQuery = `
      SELECT b.*, g.genre_name
      FROM books b
      LEFT JOIN genres g ON b.genre_id = g.genre_id
      ${whereClause}
      ${orderByClause}
      LIMIT ${Number(limit)} OFFSET ${offset}
    `;

    const books = await copyQuery(dataQuery);

    res.json({
      success: true,
      data: books,
      pagination: {
        total: totalBooks,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalBooks / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Error in /api/books/search:", error);
    res.status(500).json({
      success: false,
      message: "Error searching books",
    });
  }
});

app.get("/api/books/filters", async (req, res) => {
  try {
    // Genres
    const genresQuery = `
  SELECT DISTINCT g.genre_name
  FROM genres g
  INNER JOIN books b ON b.genre_id = g.genre_id
  ORDER BY g.genre_name
`;
    const genres = await copyQuery(genresQuery);

    // Authors
    const authorsQuery =
      "SELECT DISTINCT author FROM books WHERE author IS NOT NULL ORDER BY author";
    const authors = await copyQuery(authorsQuery);

    // Year range (FIXED)
    // Get year range from published_date
    const yearQuery = `
  SELECT 
    MIN(YEAR(published_date)) AS minYear,
    MAX(YEAR(published_date)) AS maxYear
  FROM books
  WHERE published_date IS NOT NULL
`;

    const yearRange = await copyQuery(yearQuery);

    res.json({
      success: true,
      data: {
        genres: genres.map((g) => g.genre_name),
        authors: authors.map((a) => a.author),
        yearRange: {
          min: yearRange[0].minYear || 1900,
          max: yearRange[0].maxYear || new Date().getFullYear(),
        },
        ratingRange: {
          min: 0,
          max: 5,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching filters:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching filter options",
    });
  }
});

app.listen(process.env.DB_PORT, () => {
  console.log(`App is listening on port ${process.env.DB_PORT}`);
});

// //Find friends of  a user
// app.get("/userFriends/:userId", async (req, res) => {
//   let { userId } = req.params;
//   let data = await copyExecute({
//     sql: `select * from  user where userId in (select receiver from friendships where sender=?)`,
//     first: userId,
//   });
//   let data1 = await copyExecute({
//     sql: `select * from  user where userId in (select sender from friendships where receiver=?)`,
//     first: userId,
//   });
//   data.push(...data1);
//   const seenUserIds = new Set();
//   const uniqueData = data.filter((obj) => {
//     if (!seenUserIds.has(obj.userId)) {
//       seenUserIds.add(obj.userId);
//       return true;
//     }
//     return false;
//   });
//   res.status(200).json(uniqueData);
// });

// app.delete("/deleteFriend/:userId/:friendId", async (req, res) => {
//   let { userId, friendId } = req.params;
//   await copyExecute({
//     sql: `delete from friendships where sender=? and receiver=?`,
//     first: userId,
//     second: friendId,
//   });
//   await copyExecute({
//     sql: ` delete from friend_requests where sender_id=? and receiver_id=?`,
//     first: friendId,
//     second: userId,
//   });
//   res.status(200).send("Success");
// });

////Delete request
// app.delete("/deleteRequest/:user/:receiverId", async (req, res) => {
//   let { user, receiverId } = req.params;
//   await copyExecute({
//     sql: `delete from friend_requests where sender_id=? and receiver_id=?`,
//     first: user,
//     second: receiverId,
//   });
//   res.status(200).send("Success");
// });

// //Get all requets of a User
// app.get("/requests/:reqId", async (req, res) => {
//   try {
//     const { reqId } = req.params;

//     const sqlRequests = `SELECT * FROM friend_requests WHERE receiver_id = ?`;

//     const freindsId = await copyExecute({
//       sql: sqlRequests,
//       first: reqId,
//     });

//     const usersDataPromises = freindsId.map((request) =>
//       copyExecute({
//         sql: `SELECT * FROM user WHERE userId = ?`,
//         first: request.sender_id,
//       }).then((data) => data[0]),
//     );

//     const allUsers = await Promise.all(usersDataPromises);

//     res.status(200).json({ allUsers, freindsId });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// });

// //Request Accepted
// app.post("/accepted", async (req, res) => {
//   let { addedId, userId } = req.body;
//   console.log("went");
//   await copyExecute({
//     sql: `update friend_requests set status='accepted' where receiver_id=? and sender_id=?`,
//     first: userId,
//     second: addedId,
//   });
//   let getUser = await copyExecute({
//     sql: `select * from friendships where sender=? and receiver=?`,
//     first: userId,
//     second: addedId,
//   });
//   if (getUser.length === 0) {
//     await copyExecute({
//       sql: `insert into friendships(sender,receiver) values(?,?)`,
//       first: userId,
//       second: addedId,
//     });
//   }
//   res.status(200).send("Success");
// });

// app.post("/sendRequest", async (req, res) => {
//   let { user, receiverId } = req.body;
//   let response = await copyExecute({
//     sql: `select * from friend_requests where sender_id=? and receiver_id=?`,
//     first: user,
//     second: receiverId,
//   });
//   if (response.length === 0) {
//     await copyExecute({
//       sql: `insert into friend_requests(sender_id,receiver_id) values(?,?)`,
//       first: user,
//       second: receiverId,
//     });
//   }
//   res.status(200).send("Success");
// });

// app.delete("/reject/:rejId/:userId", async (req, res) => {
//   try {
//     const { rejId, userId } = req.params;

//     await copyQuery(
//       `DELETE FROM friend_requests WHERE receiver_id=${userId} AND sender_id=${rejId}`,
//     );

//     res.status(200).json({ success: true });
//   } catch (error) {
//     console.error("Error:", error);
//   }
// });
