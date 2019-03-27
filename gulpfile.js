"use strict";

var gulp = require('gulp'),
	pug = require('gulp-pug'),
	scss = require('gulp-sass'),
	concat = require('gulp-concat'),
	plumber = require('gulp-plumber'),
	prefix = require('gulp-autoprefixer'),
	imagemin = require('gulp-imagemin'),
	cssImport = require('gulp-cssimport'),
	cmq = require('gulp-group-css-media-queries'),
	spritesmith  = require('gulp.spritesmith'),
	iconfont= require('gulp-iconfont'),
	iconfontCss  = require('gulp-iconfont-css'),
	svgSprite    = require('gulp-svg-sprite'),
	svgmin       = require('gulp-svgmin'),
	browserSync = require('browser-sync').create(),
	argv = require('yargs').argv,
	rename = require('gulp-rename'),
	inky = require('inky'),
	fs = require('fs'),
	path = require('path'),
	siphon = require('siphon-media-query'),
	lazypipe = require('lazypipe'),
	inlineCss = require('gulp-inline-css'),
	replace = require('gulp-replace'),
	htmlmin = require('gulp-htmlmin'),
	config = require('./config.json'),
	util = require('gulp-util'),
	prompt = require('gulp-prompt'),
	nodemailer = require('nodemailer'),
	mg = require('nodemailer-mailgun-transport'),
	awspublish = require('gulp-awspublish');

var htmlToText = require('html-to-text');

var useref = require('gulp-useref'),
	gulpif = require('gulp-if'),
	cssmin = require('gulp-clean-css'),
	uglify = require('gulp-uglify'),
	rimraf = require('rimraf'),
	notify = require('gulp-notify'),
	ftp = require('vinyl-ftp');

var runSequence = require('run-sequence');


var paths = {
	blocks: 'blocks/',
	devAssetsDir: 'public/assets/',
	devDir: 'public/',
	outputDir: 'build/'
};

var babel = require('gulp-babel');
var sourcemaps = require('gulp-sourcemaps');
var browserSyncReuseTab = require('browser-sync-reuse-tab')(browserSync)

var prod = argv.prod || false;

var sendTemplate;
var sendList;
var awsDir = config.meta.year + '/' + config.meta.client + '/' + config.meta.job + '/assets/img';

/*********************************
 Developer tasks
 *********************************/

//pug compile
gulp.task('pug', function() {
	return gulp.src([paths.blocks + '*.pug', '!' + paths.blocks + 'template.pug' ])
		.pipe(plumber())
		.pipe(pug({
			pretty: true,
			data: { prod: prod, version: 'v0.0.6' }
		}))
		.pipe(inky())
		.pipe(gulp.dest(paths.devDir))
		.pipe(gulpif(!prod, browserSync.stream()))
});

//scss compile
gulp.task('scss', function() {
	return gulp.src(paths.blocks + '*.scss')
		.pipe(plumber())
		.pipe(gulpif(!prod, sourcemaps.init()))
		.pipe(scss().on('error', scss.logError))
		.pipe(gulpif(!prod, sourcemaps.write('.')))			
		.pipe(gulpif(prod, cssImport()))
		.pipe(gulpif(prod, cmq()))
		.pipe(gulpif(prod, prefix({
			browsers: ['last 10 versions'],
			cascade: true
		})))
		.pipe(gulpif(prod, cssmin()))
		.pipe(gulpif(prod, rename({suffix: '.min'})))
		.pipe(gulp.dest(paths.devAssetsDir + 'css/'))
		.pipe(gulpif(!prod, browserSync.stream()))
});

//watch
gulp.task('watch', function() {
	gulp.watch(paths.blocks + '**/*.pug', ['pug']);
	gulp.watch(paths.blocks + '**/*.scss', ['scss']);
});

gulp.task('watchLife', function() {
  gulp.watch(paths.blocks + '**/*.pug',  ['pugInliner']);
  gulp.watch(paths.blocks + '**/*.scss', function() {
    runSequence('scss', 'pugInliner');
  });
});


//server
gulp.task('browser-sync', function() {
	browserSync.init({
		port: 3006,
		server: {
			baseDir: paths.devDir
		},
		open: false // do not automatically open browser
	}, browserSyncReuseTab);
});

/*********************************
 Production tasks
 *********************************/

//clean
gulp.task('clean', function(cb) {
	rimraf(paths.outputDir, cb);
});

// Inline CSS and minify HTML
gulp.task('pugInliner', function inline() {
   gulp.src([paths.blocks + '*.pug', '!' + paths.blocks + 'template.pug' ])
    .pipe(plumber())
    .pipe(pug({
      pretty: true,
      data: { prod: prod, version: 'v0.0.6' }
    }))
    .pipe(inky())
    .pipe(gulp.dest('public'));

  return gulp.src('public/*.html')
    .pipe(inliner('public/assets/css/main.css'))
    .pipe(gulp.dest('public'))
    .pipe(gulpif(!prod, browserSync.stream()))
})

// Inline CSS and minify HTML
gulp.task('inlineNow', function inline() {
  return gulp.src('public/*.html')
    .pipe(inliner('public/assets/css/main.css'))
    .pipe(gulp.dest('build'));
})

// Inlines CSS into HTML, adds media query CSS into the <style> tag of the email, and compresses the HTML
function inliner(css) {
  var css = fs.readFileSync(css).toString();
  var mqCss = siphon(css);

  var pipe = lazypipe()
    .pipe(inlineCss, {
      applyStyleTags: false,
      removeStyleTags: false,
      removeLinkTags: false,
      applyWidthAttributes: true,
    })
    .pipe(replace, '<!-- <style> -->', `<style>${mqCss}</style>`)
    .pipe(replace, '<link rel="stylesheet" href="/assets/css/main.css">', '')
    .pipe(htmlmin, {
      collapseWhitespace: true,
      minifyCSS: true
    });

  return pipe();
}

// Send email
gulp.task('deliverEmail', function deliverEmail() {
  return gulp.src('./')
    .on('end', () => {
      util.log('Sending: ', sendTemplate)
      util.log('To: ', sendList)
      return sendEmail(sendTemplate, sendList)
    })
})


// Choose template (all, index.html, version2.html)
function getFiles(dir) {
  return fs.readdirSync(dir)
    .filter(function(file) {
        return !fs.statSync(path.join(dir, file)).isDirectory();
    });
}
gulp.task('chooseTemplate', function chooseTemplate() {
    if (fs.existsSync(paths.outputDir)) {
        let fileList = getFiles(paths.outputDir);
        if (fileList.length > 0) {
            return gulp.src('./')
                .pipe(prompt.prompt({
                    type: 'list',
                    name: 'fileList',
                    message: 'Choose email template.',
                    choices: fileList 
                }, function(res) {
                      util.log(util.colors.green('Template selected: ' + res.fileList));
                      sendTemplate = res.fileList
                }));
        }
    }
})


// This is your API key that you retrieve from www.mailgun.com/cp (free up to 10K monthly emails)
var auth = {
  auth: config.mailgun
}
// Choose list (default)
gulp.task('chooseList', function chooseList() {
  if (config.testing.lists) {
      let testingLists = Object.keys(config.testing.lists);
      return gulp.src('./')
          .pipe(prompt.prompt({
              type: 'list',
              name: 'sendList',
              message: 'Choose list to send to.',
              choices: testingLists
          }, function(res) {
                util.log(util.colors.green('List selected: ' + res.sendList));
                sendList = config.testing.lists[res.sendList]
          }));
    }
})

// Reusable email †ransport function
function sendEmail(template, recipient) {
  try {
      var options = {
          include_script : false,
          include_style : false,
          compact_whitespace : true,
          include_attributes : { 'alt': true }
      };
      var nodemailerMailgun = nodemailer.createTransport(mg(auth));

      var templatePath = "./build/" + template;

      var encoding = 'utf8'
      var templateContent = fs.readFileSync(templatePath, encoding='utf8');
      
      var currentdate = new Date(); 
      var datetime = currentdate.getDate() + "/"
                      + (currentdate.getMonth()+1)  + "/" 
                      + currentdate.getFullYear() + " @ "  
                      + currentdate.getHours() + ":"  
                      + currentdate.getMinutes() + ":" 
                      + currentdate.getSeconds();
      
      var PlainText = htmlToText.fromString(templateContent);
      
      var mailOptions = {
          from: config.testing.from, // sender address
          to: recipient, // list of receivers
          subject: config.meta.job + ' - ' + config.meta.client + ' - ' + datetime, // Subject line
          html: templateContent, // html body
          text: PlainText
      };

      nodemailerMailgun.sendMail(mailOptions, function(error, info){
          if(error){
              return util.log(error);
          } else {
              return util.log('Message sent: ' + info.message);
          }
      });
  } catch (e) {
      if(e.code == 'ENOENT') {
          util.log('There was an error. Check your template name to make sure it exists in ./dist');
      } else if(e instanceof TypeError) {
          util.log('There was an error. Please check your config.json to make sure everything is spelled correctly');
      } else {
          util.log(e);
      }
  }
}

// Upload files to S3
gulp.task('aws', function aws() {
  let publisher = !!config.aws ? awspublish.create(config.aws) : awspublish.create();
  let headers = {
    'Cache-Control': 'max-age=315360000, no-transform, public'
  }
  return gulp.src('./public/**/*')
    // Set directory
    // eg. /2017/nab/nar0000-edm/assets/css/
    .pipe(rename((path) => {
        awsDir = config.meta.year + '/' + config.meta.client + '/' + config.meta.job + '/' + path.dirname
        path.dirname = '/' + awsDir
    }))
    // publisher will add Content-Length, Content-Type and headers specified above
    // If not specified it will set x-amz-acl to public-read by default
    .pipe(publisher.publish(headers))
    // create a cache file to speed up consecutive uploads
    .pipe(publisher.cache())
    // Delete old job files
    .pipe(publisher.sync(config.meta.year + '/' + config.meta.client + '/' + config.meta.job))
    // print upload updates to console
    .pipe(awspublish.reporter());
})

// Report Link
gulp.task('link', function link() {
  return gulp.src('./')
    .on('end', () => {
      util.log('Staging Link: (Hold CMD + LeftClick on link)')
      util.log(config.aws.url + '/' + config.meta.year + '/' + config.meta.client + '/' + config.meta.job)
    })
})

// Convert image paths to AWS
gulp.task('replaceImagePaths', function replaceImagePaths() {
  let awsURL = !!config && !!config.aws && !!config.aws.url ? config.aws.url : false;
  awsURL = awsURL + '/' + awsDir
  return gulp.src('build/*.html')
    .pipe(gulpif(!!awsURL, replace(/=('|")(\/?assets\/img)/g, "=$1"+ awsURL)))
    .pipe(gulpif(!!awsURL, replace(/url\((\/?assets\/img)/g, "url\("+ awsURL)))
    .pipe(gulp.dest('build'))
    .on('end', () => {
      util.log('Replaced paths with:', awsURL)
    })
})

// Build, upload and send emails
gulp.task('send', function() {
    runSequence('chooseTemplate', 'chooseList', 'replaceImagePaths', 'deliverEmail');
});

gulp.task('pack', function() {
    runSequence('chooseTemplate', 'replaceImagePaths');
});

// Upload email
gulp.task('upload', function() {
    runSequence('aws', 'link');
});

//default
gulp.task('default', ['browser-sync', 'watch', 'pug', 'scss']);

gulp.task('life', ['browser-sync', 'watchLife', 'scss', 'pugInliner']);

gulp.task('test', function() {
  runSequence('pug', 'scss', 'inlineNow', 'replaceImagePaths');
});

//production
gulp.task('build', function() {
    runSequence('pug', 'scss', 'inlineNow');
});
