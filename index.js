"use strict";

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

		let finalfolder = "";
		let finalfile = "";
		  
		// Will be called when the download starts.
		video.on('info', function(info) {

			filename = filename || info._filename;
			folder = folder || "Unsorted";
			
			var p = path.join(__dirname,"music");
			fs.mkdir(p,function(){
				p = path.join(p,folder);
				fs.mkdir(p,function(){
					p = path.join(p,filename);
					console.log("Saving",folder,filename);
					
					finalfolder = folder;
					finalfile = filename;
					
					video.pipe(fs.createWriteStream(p));
				});
			});
			
		});
		
		video.on('end',()=>{
			console.log("Saved",finalfolder,finalfile);
			resolve({finalfolder:finalfolder,finalfile:finalfile});
		});
	});

}

var buildChannelRequest = function(channel,moreparams){
	
	console.log("buildChannelRequest",arguments);
	
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
		console.log(url);

		var parseIndividualVideo = function(v){
			
			return new Promise((resolve,reject)=>{
				getCache().then(cache => {
			
					cache.channels = cache.channels || {};
					cache.channels[channel] = cache.channels[channel] || [];
					
					let found = false;
					cache.channels[channel].forEach( (el,i,arr) => {
						if(found) return;
						if(el.id == v.id.videoId) { found = true; resolve(); }
					});
					if(found) return;
					
					var url = 'https://www.youtube.com/watch?v='+v.id.videoId;
					
					download(url,v.snippet.channelTitle).then((data) => {
						
						let finalfolder = data.finalfolder;
						let finalfile = data.finalfile;
						
						cache.channels[channel].push({id:v.id.videoId,date:+new Date(),dir:finalfolder,file:finalfile});
						saveCache(cache).then(()=>{
							resolve();
						});
						
					});

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

let tooOld = age => {
	const max = 1000 * 60 * 60 * 24 * 10; // ten days
	return (age > max);
}

let pruneOldVideos = () => {
	return new Promise( (resolve,reject) => {
		getCache().then(cache => {
			for(let x in cache.channels){
				let channel = cache.channels[x];
				for(let x in channel){
					let media = channel[x];
					media.date = media.date || (+new Date);
					let age = (+new Date) - media.date;
					console.log(age);
					if(tooOld(age)){
						console.log("dieeeee");
					}
				}
			}
			resolve();
		});
	});
};

//var channels = ['UCTPjZ7UC8NgcZI8UKzb3rLw'];
var channels = pkg.channels || [];
parseChannels(channels)
.then(()=>{
	console.log("Done Getting New Content");
	return pruneOldVideos();
})
.then(()=>{
	console.log("Done Pruning Old Content");
})

//download('https://www.youtube.com/watch?v=p-z2W5QULk8');