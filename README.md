# nodejs
Node.js server for push notifications and geotracking.

## Setup
First download the latest Node.js release.
```
cd /home/marc/Downloads
wget https://nodejs.org/dist/v0.12.7/node-v0.12.7-linux-x64.tar.gz
tar -xvf node-v0.12.7-linux-x64.tar.gz
sudo mv node-v0.12.7-linux-x64 /opt
```

Then clone this git repo.
```
mkdir -p /home/marc/workspace/bento
cd /home/marc/workspace/bento
git clone git@github.com:bentocorp/nodejs.git
```

Then set up symlinks to the Node.js binaries so you can launch the server from your local git repo.
```
cd /home/marc/workspace/bento/nodejs
ln -s /opt/node-v0.12.7-linux-x64/bin/node node
ln -s /opt/node-v0.12.7-linux-x64/bin/npm npm
```

Install the necessary node modules and create a .gitignore file so you only commit Javascript source code. Please do not commit binaries or build files!
```
./npm install socket.io
./npm install redis
./npm install express
touch .gitignore
```

Put this in your .gitignore file:
```
.gitignore
node
npm
node_modules
```

To run the server locally:
```
./node server.js --env=local
```

