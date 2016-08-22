"use strict";

const querystring = require('querystring');
const https = require('https');
const path = require('path');
const fs = require('fs');
const pkg = require('./package.json');

var cachepath = './cache.json';

var getCache = function(){
	var loadFromFile = new Promise((resolve,reject) => {
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
	
	return new Promise(done=>{
		loadFromFile.then(cache => {
			// Middle layer
			cache.downloaded = cache.downloaded || {};
			done(cache);
		})
	})
	
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

// AKA the "should we have this" module
var videoGauntlet = function(v,ignorecache){
	
	return new Promise((resolve,reject) => {
		
		getCache().then(cache => {
						
			if(!ignorecache){
				// Cached?
				if(cache.downloaded[v.id.videoId]){
					//console.log("Cached, skip.")
					return reject();
				}
			}
			
			// Only allow the freshest beats
			var pub = new Date(v.snippet.publishedAt).getTime();
			var now = new Date().getTime();
			var age = (now - pub) / (1000 * 60 * 60 * 24); //days
			if(age > 14) {
				//console.log("Too old, skip.");
				return reject();
			}
			
			//Is video?
			if('youtube#video' != v.id.kind){
				//console.log("Not a video, skip.")
				return reject();
			}
			
			// OK!			
			return resolve();
			
		}).catch(e=>{
			console.error(e);
		});
		
	});
	
}

var downloadAndSave = function(v){
	
	return new Promise((resolve,reject)=>{
		getCache().then(cache => {
			var url = 'https://www.youtube.com/watch?v='+v.id.videoId;
			
			download(url,v.snippet.channelTitle).then((data) => {
				
				let finalfolder = data.finalfolder;
				let finalfile = data.finalfile;
				
				let obj = {
					v:v,
					date:+new Date(),
					dir:finalfolder,
					file:finalfile,
				}
				
				cache.downloaded[v.id.videoId] = obj;
				saveCache(cache).then(()=>{
					resolve();
				});
				
			}).catch(e=>{
				console.error(e);
			});
		});
	})
	
}

var getChannelVideos = function(channel){

	return new Promise((resolve,reject)=>{
		
		var parseIndividualVideo = function(v){
			return new Promise((resolve,reject)=>{
				videoGauntlet(v).then(()=>{
					// Video needs to be downloaded.
					downloadAndSave(v).then(resolve);
				},()=>{
					// Video can be skipped.
					resolve();
				})					
					
			});
		}
		
		var parseVideos = function(list){
			return new Promise(resolve => {
				if(!list.length) return resolve();
				parseIndividualVideo(list.shift()).then(()=>{
					resolve(parseVideos(list));
				});
			});
		}
		
		var url = buildChannelRequest(channel);
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

let removeMedia = (media) => {
	return new Promise((resolve,reject)=>{
		let p = path.join(__dirname,"music",media.dir,media.file);
		return resolve(); // skip
		fs.unlink(p, err =>{
			if(err)reject(err);
			else resolve();
		});
	})
}

let pruneOldVideos = () => {
	let main = new Promise( (resolve,reject) => {
		getCache().then(cache => {
			
			let splicers = [];
			let queue = Promise.resolve();
			for(let i in cache.downloaded){
				const el = cache.downloaded[i];
				queue = queue.then(()=>{
					return videoGauntlet(el.v,true).then(()=>{
						// Keep
					},()=>{
						// Drop
						splicers.push(el);
					})
				})
			}
			
			queue = queue.then(()=>{
				return new Promise(done=>{
					// remove all "dones"
					for( let i in splicers ){
						let media = splicers[i];
						queue = queue.then(()=>{
							return removeMedia(splicers[i]).then(()=>{
								let id = media.v.id.videoId;
								delete cache.downloaded[id];
							},err=>{
								console.log("Unable to prune media, will try later.",media);
							});
						})
					}
					
					queue = queue.then(()=>{
						saveCache(cache).then(()=>{
							resolve();
						});
					});
					
					done();
				});
			});
			
			queue.catch(e=>{
				console.error(e);
			});
			
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