const express = require("express");
const app = express();
const httpObj = require("http");
const http = httpObj.createServer(app);
const mongodb = require("mongodb");
const mongoClient = mongodb.MongoClient;
const ObjectId = mongodb.ObjectId;
const nodemailer = require("nodemailer");
const fileSystem = require("fs");
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });






app.set("view engine", "ejs");
app.use(express.static(__dirname + "/public"));

var session = require("express-session");
app.use(session({
    secret: "secret key",
    resave: false,
    saveUninitialized: false
}));

const mainURL = "http://localhost:3000";



app.use(function (request, result, next) {
    request.mainURL = mainURL;
    request.isLogin = (typeof request.session.user !== "undefined");
    request.user = request.session.user;
    next();
});

var formidable = require("express-formidable");
app.use(formidable());

var bcrypt = require("bcrypt");
const e = require("express");

let database;
app.use(express.json());

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "hardikgurjar174@gmail.com",
        pass: "hotg oayf wcdj jugy"
    }
});


async function sendVerificationEmail(userEmail, verificationToken) {
    try {
        let mailOptions = {
            from: "hardikgurjar174@gmail.com",
            to: userEmail,
            subject: "Verify Your Email",
            html: `<p>Please verify your account by clicking the link below to use CloudBridge:</p>
                <a href="${mainURL}/verifyEmail/${userEmail}/${verificationToken}">
                    Confirm Email
                </a>`

        };

        await transporter.sendMail(mailOptions);
        console.log("Verification email sent successfully.");
    } catch (error) {
        console.error("Failed to send email:", error);
    }
}



// recursive function to get folder from uploaded
function recursiveGetFolder(files, _id) {
    for (let a = 0; a < files.length; a++) {
        const currentFile = files[a];
        if (currentFile._id == _id) {
            return currentFile;
        }

        if (currentFile.type === "folder" && currentFile.files.length > 0) {
            const found = recursiveGetFolder(currentFile.files, _id);
            if (found) return found;
        }
    }

    return null;
}
// get folder from uploaded files


//function to created new updated object and return the updated array

function getUpdatedArray(arr, _id, uploaded){
    for (var a = 0; a < arr.length; a++){
        if(arr[a].type == "folder"){
            if (arr[a]._id == _id){  // FIXED: _id, not id
                arr[a].files.push(uploaded); // FIXED: uploaded, not uploadedObj
            }

            if (arr[a].files.length > 0){
                arr[a].files = getUpdatedArray(arr[a].files, _id, uploaded);
            }
        }
    }

    return arr;
}

// recursive folder to get file from folder

function recursiveGetFile(files, _id) {
    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (file.type !== "folder" && file._id == _id) {
            return file;
        }

        if (file.type === "folder" && file.files.length > 0) {
            const found = recursiveGetFile(file.files, _id);
            if (found) return found;
        }
    }
    return null;
}


http.listen(3000, async function () {
    console.log("Server started at:", mainURL);

    try {
        const client = await mongoClient.connect("mongodb://localhost:27017");
        database = client.db("file_transfer");
        console.log("Database Connected.");
          // share the files with the user 
          app.post("/Share", async function (request, result) {
            const _id = request.fields._id;
            const type = request.fields.type;
            const email = request.fields.email;
        
            if (!request.session.user) {
                return result.redirect("/Login");
            }
        
            const user = await database.collection("users").findOne({
                "email": email
            });
        
            if (!user) {
                request.session.status = "error";
                request.session.message = "User " + email + " does not exist.";
                return result.redirect("/my-uploads");
            }
        
            if (!user.isVerified) {
                request.session.status = "error";
                request.session.message = "User " + email + " account is not verified.";
                return result.redirect("/my-uploads");
            }
        
            const me = await database.collection("users").findOne({
                "_id": new  ObjectId(request.session.user._id)
            });
        
            let file = null;
            if (type === "folder") {
                file = await recursiveGetFolder(me.uploaded, _id);
            } else {
                file = await recursiveGetFile(me.uploaded, _id);
            }
        
            if (!file) {
                request.session.status = "error";
                request.session.message = "The file or folder does not exist.";
                return result.redirect("/my-uploads");
            }
        
            file._id = new ObjectId(file._id); // ensure ObjectId format
            const sharedBy = me;
        
            await database.collection("users").findOneAndUpdate(
                { "_id": user._id },
                {
                    $push: {
                        "sharedWithMe": {
                            "_id": new ObjectId(),
                            "file": file,
                            "sharedBy": {
                                "_id": new ObjectId(sharedBy._id),
                                "name": sharedBy.name,
                                "email": sharedBy.email
                            },
                            "createdAt": new Date().getTime()
                        }
                    }
                }
            );
        
            request.session.status = "success";
            request.session.message = "File has been shared with " + user.name + ".";
        
            const backURL = request.header("Referer") || "/";
            return result.redirect(backURL);
        });
        
        // get user for confirmation
        app.post("/GetUser", async function (request, result) {
            const email = request.fields.email;
        
            if (!request.session.user) {
                return result.json({
                    status: "error",
                    message: "Please login to perform this action."
                });
            }
        
            const user = await database.collection("users").findOne({
                "email": email
            });
        
            if (!user) {
                return result.json({
                    status: "error",
                    message: "User " + email + " does not exist."
                });
            }
        
            if (!user.isVerified) {
                return result.json({
                    status: "error",
                    message: "User " + email + " account is not verified."
                });
            }
        
            return result.json({
                status: "success",
                message: "User found.",
                user: {
                    _id: user._id,
                    name: user.name,
                    email: user.email
                }
            });
        });

        app.get('/shared-with-me', async (req, res) => {
            try {
                if (!req.user || !req.user._id) {
                    return res.status(400).send("User is not logged in");
                }
        
                const user = await database.collection("users").findOne({ _id: new ObjectId(req.user._id) });
        
                if (!user || !user.sharedWithMe || user.sharedWithMe.length === 0) {
                    return res.render("shared-with-me", {
                        sharedWithMe: [],
                        request: req
                    });
                }
        
                res.render("shared-with-me", {
                    sharedWithMe: user.sharedWithMe,
                    request: req
                });
            } catch (error) {
                console.error("Error fetching shared files:", error);
                res.status(500).send("Internal Server Error");
            }
        });
        
        

        app.post("/UploadFile", async function (request, result) {
            if (request.session.user) {
                const user = await database.collection("users").findOne({
                    "_id": new ObjectId(request.session.user._id)
                });
        
                if (!user) {
                    request.status = "error";
                    request.message = "User not found.";
                    return result.redirect("/Login");
                }
        
                if (request.files && request.files.file && request.files.file.size > 0) {
                    const file = request.files.file;
                    const _id = request.fields._id;
                    const tempFilePath = file.path; // Consistent way to get temporary path
        
                    let uploadedObj = {
                        "_id": new ObjectId(),
                        "size": file.size,
                        "name": file.name,
                        "originalName": file.name, // 🔧 add this
                        "folderName": file.name, // 🔧 add this (for display)
                        "type": "file", // 🔧 add this so EJS knows it’s a file
                        "filePath": "",
                        "createdAt": new Date().getTime()
                    };
                    
        
                    if (_id == "") {
                        const newFilePath = `public/uploads/${user.email}/${new Date().getTime()}-${file.name}`;
                        uploadedObj.filePath = newFilePath;
                        if (!fileSystem.existsSync(`public/uploads/${user.email}`)) {
                            fileSystem.mkdirSync(`public/uploads/${user.email}`);
                        }
                        // Proceed with file reading and writing using newFilePath
                        fileSystem.readFile(tempFilePath, function (err, data) {
                            if (err) throw err;
                            console.log('file read!');
                            fileSystem.writeFile(newFilePath, data, async function (err) {
                                if (err) throw err;
                                console.log('file written!');
                                await database.collection("users").updateOne(
                                    { "_id": new ObjectId(request.session.user._id) },
                                    { $push: { "uploaded": uploadedObj } }
                                );
                                fileSystem.unlink(tempFilePath, function (err) {
                                    if (err) throw err;
                                    console.log('Temporary file deleted!');
                                });
                                result.redirect("/my-uploads/" + _id);
                            });
                        });
                    } else {
                        const folderObj = await recursiveGetFolder(user.uploaded, _id);
                        if (!folderObj) {
                            request.status = "error";
                            request.message = "Folder not found.";
                            return result.redirect("/my-uploads"); // Or handle appropriately
                        }
                        const newFilePath = `${folderObj.folderPath}/${file.name}`;
                        uploadedObj.filePath = newFilePath;
                        const updatedArray = await getUpdatedArray(user.uploaded, _id, uploadedObj);
                       
                        fileSystem.readFile(tempFilePath, function (err, data) {
                            if (err) throw err;
                            console.log('file read!');
                            fileSystem.writeFile(newFilePath, data, async function (err) {
                                if (err) throw err;
                                console.log('file written!');
                                const updatedArrayWithObjectIds = updatedArray.map(item => ({ ...item, _id: new ObjectId(item._id) }));
                                await database.collection("users").updateOne(
                                    { "_id": new ObjectId(request.session.user._id) },
                                    { $set: { "uploaded": updatedArrayWithObjectIds } }
                                );
                               

                                fileSystem.unlink(tempFilePath, function (err) {
                                    if (err) throw err;
                                    console.log('Temporary file deleted!');
                                });
                                result.redirect("/my-uploads/" + _id);
                            });
                        });
                    }
                } else {
                    request.status = "error";
                    request.message = "Please select a valid file.";
                    console.log(uploaded);
                         
                    return result.render("my-uploads", { request, uploaded: uploaded });
                }
            } else {
                return result.redirect("/Login");
            }
         
              
        });
                
        app.get("/my-uploads/:_id?", async function(request, result) {

            const _id = request.params._id;
            if (request.session.user){

                var user = await database.collection("users").findOne({
                    "_id": new ObjectId(request.session.user._id)

                });

                app.post("/CreateFolder", async function (request, result) {
                    if (request.session.user) {
                        const user = await database.collection("users").findOne({
                            "_id": new ObjectId(request.session.user._id)
                        });
                
                        if (!user) {
                            request.status = "error";
                            request.message = "User not found.";
                            return result.redirect("/Login");
                        }
                
                        const folderName = request.fields.name;
                        const _id = request.fields._id;
                
                        let folderPath = "";
                        if (_id) {
                            const parentFolder = await recursiveGetFolder(user.uploaded, _id);
                
                            if (!parentFolder) {
                                request.status = "error";
                                request.message = "Parent folder not found.";
                                return result.redirect("/my-uploads");
                            }
                
                            if (!parentFolder.folderPath) {
                                parentFolder.folderPath = `public/uploads/${user.email}`; // fallback if missing
                            }
                
                            folderPath = `${parentFolder.folderPath}/${folderName}`;
                
                            if (!fileSystem.existsSync(folderPath)) {
                                fileSystem.mkdirSync(folderPath, { recursive: true });
                            }
                
                            const newFolder = {
                                _id: new ObjectId(),
                                folderName: folderName,
                                folderPath: folderPath,
                                type: "folder",
                                files: [],
                                createdAt: new Date().getTime()
                            };
                
                            parentFolder.files.push(newFolder);
                
                        } else {
                            folderPath = `public/uploads/${user.email}/${folderName}`;
                            if (!fileSystem.existsSync(folderPath)) {
                                fileSystem.mkdirSync(folderPath, { recursive: true });
                            }
                
                            const newFolder = {
                                _id: new ObjectId(),
                                folderName: folderName,
                                folderPath: folderPath,
                                type: "folder",
                                files: [],
                                createdAt: new Date().getTime()
                            };
                
                            user.uploaded.push(newFolder);
                        }
                
                        await database.collection("users").updateOne(
                            { "_id": new ObjectId(request.session.user._id) },
                            { $set: { "uploaded": user.uploaded } }
                        );
                
                        result.redirect("/my-uploads" + (_id ? "/" + _id : ""));
                    } else {
                        return result.redirect("/Login");
                    }
                });

                app.post("/DeleteItem", async function (req, res) {
    const userId = req.session.user._id;
    const itemId = req.fields.itemId;

    const user = await database.collection("users").findOne({ "_id": new ObjectId(userId) });
    if (!user) return res.redirect("/Login");

    function deleteRecursively(arr, id) {
        return arr.filter(item => {
            if (item._id == id) {
                if (item.filePath && fileSystem.existsSync(item.filePath)) {
                    fileSystem.unlinkSync(item.filePath); // delete file
                }
                return false;
            }
            if (item.type === "folder" && item.files.length > 0) {
                item.files = deleteRecursively(item.files, id);
            }
            return true;
        });
    }

    user.uploaded = deleteRecursively(user.uploaded, itemId);

    await database.collection("users").updateOne(
        { "_id": new ObjectId(userId) },
        { $set: { uploaded: user.uploaded } }
    );

    res.redirect("/my-uploads");
});

                

                var uploaded = null;
                var folderName = "";
                var createdAt="";
                if(typeof _id == "undefined"){
                    uploaded = user.uploaded;
                }else{
                    var folderObj = await recursiveGetFolder(user.uploaded,_id);

                    if (folderObj == null ){
                        request.status = "error";
                        request.message= "Folder not found.";
                        result.render ("my-uploads",{
                            "request":request
                        });
                        return false;
                    }

                    uploaded = folderObj.files;
                    folderName = folderObj.folderName;
                    createdAt = folderObj.createdAt;
                }
                if (uploaded == null){
                    request.status = "error";
                    request.message= "Directory not found.";
                    result.render("my-uploads", {

                        "request":request,
                        "uploaded":uploaded,
                        "_id": _id,
                        "folderName":folderName,
                        "createdAt":createdAt
                });
                return false;
            }

            result.render("my-uploads",{
                "request":request,
                "uploaded":uploaded,
                "_id": _id,
                "folderName":folderName,
                "createdAt":createdAt
                
            });
        return false;
        }  
         result.redirect("/Login");

        });

        app.post("/DeleteItem", async function (req, res) {
            const userId = req.session.user._id;
            const itemId = req.fields.itemId;
        
            const user = await database.collection("users").findOne({ "_id": new ObjectId(userId) });
            if (!user) return res.redirect("/Login");
        
            // 🔁 Recursive delete function
            function deleteRecursively(arr, id) {
                return arr.filter(item => {
                    if (item._id == id) {
                        // Delete file from disk
                        if (item.type === "file" && item.filePath && fileSystem.existsSync(item.filePath)) {
                            fileSystem.unlinkSync(item.filePath);
                        }
        
                        // Delete folder from disk
                        if (item.type === "folder" && item.folderPath && fileSystem.existsSync(item.folderPath)) {
                            fileSystem.rmdirSync(item.folderPath, { recursive: true });
                        }
        
                        return false; // Remove from DB structure too
                    }
        
                    if (item.type === "folder" && item.files.length > 0) {
                        item.files = deleteRecursively(item.files, id);
                    }
        
                    return true;
                });
            }
        
            // 🔁 Update user's uploaded array
            user.uploaded = deleteRecursively(user.uploaded, itemId);
        
            await database.collection("users").updateOne(
                { "_id": new ObjectId(userId) },
                { $set: { uploaded: user.uploaded } }
            );
        
            res.redirect("back");
        });
        



        app.get("/", function (request, result) {
            result.render("index", { "request": request });
        });





        app.get("/Register", function (request, result) {
            result.render("Register", { "request": request });
        });

        app.post("/Register", async function (request, result) {
            var name = request.fields.name;
            var email = request.fields.email;
            var password = request.fields.password;
            var verification_token = new Date().getTime();

            var user = await database.collection("users").findOne({ "email": email });

            if (user === null) {
                bcrypt.hash(password, 10, async function (error, hash) {
                    if (error) {
                        request.status = "error";
                        request.message = "Error in password hashing.";
                        return result.render("Register", { "request": request });
                    }

                    await database.collection("users").insertOne({
                        "name": name,
                        "email": email,
                        "password": hash,
                        "reset_token": "",
                        "uploaded": [],
                        "shareWithMe": [],
                        "isVerified": false,
                        "verification_token": verification_token
                    });

                    await sendVerificationEmail(email, verification_token);

                    request.status = "success";
                    request.message = "Signed up successfully. A verification email has been sent. Please verify your email before logging in.";
                    result.render("Register", { "request": request });
                });
            } else {
                request.status = "error";
                request.message = "Email already exists.";
                result.render("Register", { "request": request });
            }
        });

        app.get("/verifyEmail/:email/:verification_token", async function (request, result) {
            var email = request.params.email;
            var verification_token = request.params.verification_token;

            var user = await database.collection("users").findOne({
                $and: [
                    { "email": email },
                    { "verification_token": parseInt(verification_token) }
                ]
            });

            if (user === null) {
                request.status = "error";
                request.message = "Email does not exist or the verification link has expired.";
                return result.render("login", { "request": request });
            } else {
                await database.collection("users").updateOne(
                    { "email": email },
                    {
                        $set: {
                            "verification_token": "",
                            "isVerified": true
                        }
                    }
                );
            }



            request.status = "success";
            request.message = "Email verified successfully. Try logging in.";
            result.render("Login", { "request": request });
        });

        app.get("/Login", function (request, result) {
            result.render("Login", { request: request });
        });

        app.post("/Login", async function (request, result) {

            var email = request.fields.email;
            var password = request.fields.password;

            var user = await database.collection("users").findOne({
                "email": email
            });

            if (user == null) {
                request.status = "error";
                request.message = "Email does not exist";
                result.render("Login", {
                    "request": request
                });

                return false;
            }


            bcrypt.compare(password, user.password, function (error, isVerify) {

                if (isVerify) {
                    if (user.isVerified) {
                        request.session.user = user;
                        result.redirect("/");
                        return false;
                    }

                    request.status = "error";
                    request.message = "Kindly verify your email";
                    result.render("Login", {
                        "request": request
                    });

                    return false;
                }
                request.status = "error";
                request.message = "password is not correct.";
                result.render("Login", {
                    "request": request
                });
             });
         });

        app.get("/ForgotPassword", function (request, result) {
            result.render("ForgotPassword", {
                "request": request
            });
        });

        app.post("/SendRecoveryLink", async function (request, result) {
            var email = request.fields.email;

            var user = await database.collection("users").findOne({ "email": email });

            if (user == null) {
                request.status = "error";
                request.message = "Email does not exist";
                return result.render("ForgotPassword", {
                    "request": request,
                    mainURL
                });
            }

            var reset_token = new Date().getTime();

            await database.collection("users").findOneAndUpdate(
                { "email": email },
                { $set: { "reset_token": reset_token } }
            );

            var text = "Please click the following link to reset your password: " + mainURL + "/ResetPassword/" + email + "/" + reset_token;
            var html = "Please click the following link to reset your password:<br><br><a href='" + mainURL + "/ResetPassword/" + email + "/" + reset_token + "'>Reset Password</a><br><br>Thank you.";

            transporter.sendMail({
                from: "hardikgurjar174@gmail.com",
                to: email,
                subject: "Reset Password",
                text,
                html
            }, function (error, info) {
                if (error) {
                    console.log(error);
                } else {
                    console.log("Email sent: " + info.response);
                }

                request.status = "success";
                request.message = "Email has been sent with the link to recover the password.";
                console.log("recovery email has been sent successfully");
                result.render("ForgotPassword", {
                    "request": request,
                    mainURL
                });
            });
        });
              

        app.get("/Logout", function(request, result){
            request.session.destroy(function (err){
                if(err){
                    console.log("Logout error:",err);
                    result.render("/");
                }else{
                    result.clearCookie("connect.sid");
                    result.redirect("/Login")
                }

            });
        });

        app.get("/ResetPassword/:email/:reset_token", async function (request, result) {
            var email = request.params.email;
            var reset_token = request.params.reset_token;

            var user = await database.collection("users").findOne({
                $and: [{
                    "email": email
                }, {
                    "reset_token": parseInt(reset_token)
                }]
            });

            if (user == null) {
                request.status = "error";
                request.message = "link is expired";
                result.render("Error", {
                    "request": request,
                });

                return false;
            }

            result.render("ResetPassword", {
                "request": request,
                "email": email,
                "reset_token": reset_token
            });

        });
        app.post("/ResetPassword", async function (request, result) {
            var email = request.fields.email;
            var reset_token = request.fields.reset_token;
            var new_password = request.fields.new_password;
            var confirmPassword = request.fields.confirmPassword;
            if (new_password != confirmPassword) {
                request.status = "error";
                request.message = "Passwords do not match";

                result.render("ResetPassword", {
                    "request": request,
                    "email": email,
                    "reset_token": reset_token
                });
                return false;
            }


            var user = await database.collection("users").findOne({
                $and: [{
                    "email": email
                }, {
                    "reset_token": parseInt(reset_token)
                }]
            });

            if (user == null) {
                request.status = "error";
                request.message = "Email does not exist , recovery link is expired";
                result.render("ResetPassword", {
                    "request": request,
                    "email": email,
                    "reset_token": reset_token
                });

                return false;
            }
            bcrypt.hash(new_password, 10, async function (error, hash) {
                await database.collection("users").findOneAndUpdate({
                    $and: [{
                        "email": email
                    }, {
                        "reset_token": parseInt(reset_token)
                    }]
                }, {
                    $set: {
                        "reset_token": "",
                        "password": hash
                    }
                });
                request.status = "success";
                request.message = "Password has been changed, please login again.";
                result.render("Login", {
                    "request": request,
                });

            });

        });
    
      } catch (error) {
        console.error("Database connection failed:", error);
    }
});