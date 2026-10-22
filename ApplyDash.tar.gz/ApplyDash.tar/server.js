const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const app = express();
require('dotenv').config();
const port = process.env.PORT;
const mongoose = require('mongoose');
const User = require('./Database/User'); // استدعاء نموذج المستخدم
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');

const config = require('./Config/Config.json');

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 },
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL,
  scope: ['identify', 'email']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ discordId: profile.id });
    if (user) {
      user.lastLogin = new Date();
      await user.save();
      return done(null, user);
    } else {
      const newUser = new User({
        discordId: profile.id,
        username: profile.username,
        email: profile.email,
        lastLogin: new Date()
      });
      await newUser.save();
      return done(null, newUser);
    }
  } catch (err) {
    return done(err, null);
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  if (req.session.passport && req.session.passport.user) {
    User.findById(req.session.passport.user)
      .then(user => {
        req.user = user;
        next();
      })
      .catch(err => {
        console.error('Error fetching user:', err);
        next();
      });
  } else {
    next();
  }
});

app.get('/', (req, res) => {
  res.render('index', { title: 'الصفحة الرئيسية', config: config, user: req.user });
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', {
  failureRedirect: '/'
}), (req, res) => {
  res.redirect('/dashboard');
});

app.get('/dashboard', (req, res) => {
  if (req.isAuthenticated()) {
    res.render('dashboard', { title: 'لوحة التحكم', user: req.user, config: config });
  } else {
    res.redirect('/');
  }
});

app.get('/submissions', (req, res) => {
  if (req.isAuthenticated()) {
    res.render('submissions', { title: 'صفحة التقديمات', user: req.user, config: config });
  } else {
    res.redirect('/');
  }
});

const Submission = require('./Database/Submission');
app.post('/submit', async (req, res) => {
  console.log('Received request to /submit');
  console.log('Request headers:', req.headers);
  console.log('Request body (raw):', req.body);
  console.log('Content-Type:', req.get('Content-Type'));

  if (req.isAuthenticated()) {
    try {
      console.log('User is authenticated');
      
      if (!req.body || Object.keys(req.body).length === 0) {
        console.log('Request body is empty');
        return res.status(400).json({ success: false, error: 'بيانات التقديم فارغة' });
      }

      console.log('Parsed submission data:', req.body);
      const findSubmission = await Submission.findOne({ userId: req.user._id });
      if (findSubmission) {
        return res.status(400).json({ success: false, error: 'لقد قمت بالفعل بالتقديم' });
      }
      const submissionData = {
        userId: req.user._id,
        ...req.body
      };
      
      console.log('Final submission data:', submissionData);

      const submission = new Submission(submissionData);
      await submission.save();
      
      console.log('Submission saved successfully');
      res.json({ success: true, data: JSON.stringify(submissionData) });
    } catch (error) {
      console.error('Error saving submission:', error);
      res.status(500).json({ success: false, error: 'حدث خطأ أثناء حفظ التقديم' });
    }
  } else {
    console.log('User is not authenticated');
    res.status(401).json({ success: false, error: 'غير مصرح' });
  }
});

app.post('/admin/update-submission', async (req, res) => {
  if (req.isAuthenticated() && config.Owners.includes(req.user.discordId)) {
    try {
      const { submissionId, status } = req.body;
      
      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, error: 'حالة غير صالحة' });
      }

      const submission = await Submission.findByIdAndUpdate(
        submissionId,
        { status: status },
        { new: true }
      );

      if (!submission) {
        return res.status(404).json({ success: false, error: 'لم يتم العثور على التقديم' });
      }

      res.json({ success: true, submission: submission });
    } catch (error) {
      console.error('Error updating submission:', error);
      res.status(500).json({ success: false, error: 'حدث خطأ أثناء تحديث التقديم' });
    }
  } else {
    res.status(401).json({ success: false, error: 'غير مصرح' });
  }
});

app.get('/admin', async (req, res) => {
  if (req.isAuthenticated() && config.Owners.includes(req.user.discordId)) {
    console.log(await Submission.find())
    res.render('admin', { title: 'لوحة التحكم', user: req.user, config: config, submissions: await Submission.find() });
  } else {
    res.redirect('/');
  }
});
app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Error during logout:', err);
    }
    res.redirect('/');
  });
});

app.listen(port, () => {
  console.log(`الخادم يعمل على المنفذ ${port}`);
});



require('./Bot-Role');