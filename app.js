const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

const morgan = require('morgan');
const app = express();
const MongoClient = require('mongodb').MongoClient;
const crypto = require('crypto');
const throttle = require('express-throttle');

const dbUrl = process.env.MONGO_URL;
const port = process.env.PORT;
let db;

const USER_COOKIE_NAME = 'dartV2-poll-cookie';

app.use(bodyParser.json());
app.use(cookieParser());

let logger = morgan(function(tokens, req, res) {
    return [
        tokens.method(req, res),
        tokens.url(req, res),
        tokens.status(req, res),
        _getCookie(req) || 'unknown', // TODO use chalk
        req.body.vote || 'NONE',
        tokens['response-time'](req, res), 'ms',
    ].join(' ');
});
app.use(logger);

app.use(express.static(__dirname + '/public'));

let options = {
    'burst': 10,
    'period': '30sec',
    'key': function(req) {
        return _getCookie(req);
    },
    'on_throttled': function(req, res, next, bucket) {
        let time = bucket.etime - new Date();
        res.status(429).send({time});
    },
};

app.post('/vote', throttle(options), (req, res) => {
    let fingerprint = _getFingerprint(req);
    if(!fingerprint) {
        res.sendStatus(400);
        return;
    }

    let cookieUserId = _getCookie(req);

    if(!cookieUserId) {
        // eslint-disable-next-line max-len
        let generatedUserId = generateUserId(req.connection.remoteAddress, fingerprint);
        vote(req.body.vote, res, generatedUserId, true);
    } else {
        vote(req.body.vote, res, cookieUserId);
    }
});

function _getCookie(req) {
    return req.cookies[USER_COOKIE_NAME];
}

function _getFingerprint(req) {
    return req.headers['fingerprint'];
}

function generateUserId(ipAddr, fingerprint) {
    let rand = crypto.randomBytes(24).toString('hex');
    let data = `${ipAddr}${fingerprint}${rand}`;
    return crypto.createHash('md5').update(data).digest('hex');
}

function vote(vote, res, userId, newUser) {
    if (newUser) {
        res.cookie(USER_COOKIE_NAME, userId, {
            maxAge: 30 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: false,
        });
    }
    db.collection('votes').updateOne(
        {vote: vote},
        {$inc: {count: 1}},
        {upsert: true}
    )
        .then(() => {
            res.sendStatus(200);
        });
}

app.get('/stats', (req, res) => {
    db.collection('votes').find().toArray((err, results) => {
        if (err) {
            res.status(500).send(err);
        }
        let votes = {};
        results.forEach((result) => {
            votes[result.vote] = result.count;
        });
        res.send(votes);
    });
});

MongoClient.connect(dbUrl, (err, database) => {
    if (err) {
        return console.log(err);
    }
    db = database;
    app.listen(port, function() {
        console.log('Poll listening on port ' + port);
    });
});

