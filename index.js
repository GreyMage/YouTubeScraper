const querystring = require('querystring');
const https = require('https');
const path = require('path');
const fs = require('fs');
const pkg = require('./package.json');

var cachepath = './cache.json';

var getCache = function(){
	return new Promise((resolve,reject) => {
		var def = {};
		fs.readFile(cachepath, (err, data) => {
			if (err) {
				if(err.code == "ENOENT"){
					fs.writeFile(cachepath, JSON.stringify(def), function(err) {
						if(err) {
							return reject(err);
						}
						return resolve(def);
					}); 
				} else {
					return reject(err);
				}
			} else {	
				if(data){
					try {
						def = JSON.parse(data);
					} catch(e){}
					return resolve(def);
				} else {
					return reject();
				}
			}
		});
	});
}

var saveCache = function(cache){
	cache = cache || {};
	return new Promise((resolve,reject) => {
		fs.writeFile(cachepath, JSON.stringify(cache, null, '\t'), function(err) {
			if(err) {
				return reject(err);
			}
			return resolve(cache);
		}); 
	});
}


var download = function(url,folder,filename){

	return new Promise((resolve,reject)=>{
	
		var youtubedl = require('youtube-dl');
		var video = youtubedl(url,
		  // Optional arguments passed to youtube-dl.
		  ['--format=18','-f bestaudio'],
		  // Additional options can be given for calling `child_process.execFile()`.
		  { cwd: __dirname });

		// Will be called when the download starts.
		video.on('info', function(info) {
		
			filename = filename || info._filename;
			folder = folder || "Unsorted";
			
			var p = path.join(__dirname,"music",folder);
			fs.mkdir(p,function(){
				p = path.join(p,filename);
				video.pipe(fs.createWriteStream(p));
			});
			
		});
		
		video.on('end',()=>{
			resolve();
		});
	});

}

var buildChannelRequest = function(channel,moreparams){
	
	var base = 'https://www.googleapis.com/youtube/v3/search?';
	var params = {};
	
	params['key'] = 'AIzaSyDm3qnPLxOMsxQvEgg6MoG02L7W3mEwlAw';
	params['channelId'] =channel;
	params['part'] = ['snippet','id'].join(",");
	params['order'] = 'date';
	params['maxResults'] = '20';
	
	var s_params = querystring.stringify(params);
	return(base+s_params);
	
}

var getChannelVideos = function(channel){
	
	return new Promise((resolve,reject)=>{
		var url = buildChannelRequest(channel);

		var parseIndividualVideo = function(v){
		
			return new Promise((resolve,reject)=>{
				getCache().then(cache => {
					cache.channels = cache.channels || {};
					cache.channels[channel] = cache.channels[channel] || [];
					if(cache.channels[channel].indexOf(v.id.videoId) == -1){
						cache.channels[channel].push(v.id.videoId);
						saveCache(cache).then(()=>{
							var url = 'https://www.youtube.com/watch?v='+v.id.videoId;
							resolve(download(url,v.snippet.channelTitle));
						});
					} else {
						resolve();
					}
				});
			});

		};
		
		var parseVideos = function(list){
			return new Promise(resolve => {
				if(!list.length) return resolve();
				parseIndividualVideo(list.shift()).then(()=>{
					resolve(parseVideos(list));
				});
			});
		}
		
		https.get(url, (res) => {
			
			var buffer = '';
			res.on('data', (d) => {
				buffer += d;
			});
			res.on('end', (d) => {
				var payload = JSON.parse(buffer);
				resolve(parseVideos(payload.items));
			});

		}).on('error', (e) => {
		  console.error(e);
		})
		
	})
		
}

var parseChannels = (list) => {
	return new Promise((resolve) => {
		if(!list.length) return resolve();
		getChannelVideos(list.shift()).then(()=>{
			resolve(parseChannels(list));
		});
	});
}

//var channels = ['UCTPjZ7UC8NgcZI8UKzb3rLw'];
var channels = pkg.channels || [];
parseChannels(channels).then(()=>{
	console.log("ok");
});

//download('https://www.youtube.com/watch?v=p-z2W5QULk8');