# Node
Bento's Node.js server for push communication and geotracking. For more information about Node.js, visit https://nodejs.org/en/.

## Usage
The following instructions are for Ubuntu (or any Linux distribution) but can easily be adapted for OS X. First, clone this repository onto your local machine.

```
mkdir -p /home/marc/workspace/bento
cd /home/marc/workspace/bento
git clone git@github.com:bentocorp/nodejs.git
```

### Running the server on dev
We use Capistrano to deploy and start/stop/restart the servers on our dev and prod hosts. Follow the instructions here to download and install Capistrano: http://capistranorb.com/documentation/getting-started/installation/. Then make sure you have SSH access to those hosts. As of right now, there is 1 dev host and 0 prod hosts. Here's what my `/etc/hosts` file looks like

```
54.191.141.101  bento-dev-nodejs01
```

Node supports clustering so additional machines (on both dev and prod) will be added in the future. Also note that the IP addresses are currently not static and are subject to change.

You must configure Capistrano so that it can SSH into the host machines on your behalf. Under the `config` directory is a template called `myconfig.rb.DIST`. Copy that template to `myconfig.rb` then change the example SSH settings to reflect your own. **Do not commit this file to Github!**

```
cd /home/marc/workspace/bento/config
cp myconfig.rb.DIST myconfig.rb
```

Node also needs additional usernames and passwords to start. Those are stored in a file called `private.js` and is not on Github. Its template is private.js.DIST. You will need to get this file from another developer and securely copy it to the project's root directory. **Do not commit this file to Github either!** To make sure you don't accidentally commit `myconfig.rb` and `private.js`, are in the `.gitignore`.

Then to deploy (for example, to all dev hosts) execute the following command in the root directory

`cap dev deploy`

Note that it will ask you which branch to deploy. The default is the branch you are currently on (master). To see a list of other Capistrano tasks that are available, execute the following in the root directory

`cap -T`

For example, the Capistrano tasks to start/stop/restart Node on all dev hosts are

```
cap dev start_server
cap dev stop_server
cap dev restart_server
```

Note that `cap dev deploy` automatically starts the server.

### Running the server locally

If you want to run Node on your local machine, you need to install the neccessary dependencies. They are

1. **Node.js binaries and modules.** Download the latest Node.js binaries at https://nodejs.org/en/download/

 ```
 cd /home/marc/Downloads
 wget https://nodejs.org/dist/v0.12.7/node-v0.12.7-linux-x64.tar.gz
 tar -xvf node-v0.12.7-linux-x64.tar.gz
 sudo mv node-v0.12.7-linux-x64 /opt
 ```
 
 After you extract (decompress/un-tar) the contents, you will find two (2) programs under the `bin` directory. The first, `node`, is the actual Node.js program that will run our server. The second, `npm`, is a package manager that we will need to install additional modules that the server needs to run. You must create symlinks to these binaries in Node's root directory.

 ```
 cd /home/marc/workspace/bento/nodejs
 ln -s /opt/node-v0.12.7-linux-x64/bin/node /usr/bin/node
 ln -s /opt/node-v0.12.7-linux-x64/bin/npm /usr/bin/npm
 ```

 Then install the necessary Node.js modules. Remember to add all these files to your `.gitignore` so you only commit Javascript source code. Please do not commit binaries or build files! `node_modules` is already in the `.gitignore file`.

 ```
 cd /home/marc/workspace/bento/nodejs
 npm install
 ```

 
 ```

2. **Redis.** Redis is the in-memory cache system that Node uses. Download the binaries at http://redis.io/download.

 ```
 cd /home/marc/Downloads
 wget http://download.redis.io/releases/redis-3.0.4.tar.gz
 tar -xvf redis-3.0.4.tar.gz
 sudo mv redis-3.0.4 /opt
 cd /opt/redis-3.0.4
 make
 cd ./src
 ./redis-server (./redis-server & runs in background)

 ```

 Redis must be running when Node starts. If you look in `private.js`, Node is configured by default to connect to Redis at `localhost:6379` when it is running locally. You can change this if you want.

3. **MySQL.** When Node starts, it will try to connect to a MySQL database. You have two options:
  1. You can run a local instance of MySQL and configure Node to connect to the local instance. If you pick this option, you must create all the required tables yourself and populate them with mock data.
  2. The recommended option is to use *port forwarding* to get Node to connect to the dev MySQL database. The reason why Node can't connect to the dev database directly is because your personal computer doesn't have permissions to connect to the dev database instance. The only machines that have access to the dev database are the dev hosts, such as `bento-dev-nodejs01` or `bento-dev-api1`. Fortunately, you have access to those hosts so you can connect to dev MySQL through any one of those hosts. First, open up a new terminal to start port fowarding. The command looks like this  
    
    ```
    ssh -N <your-username>@<pick-a-dev-host> -L <pick-a-local-port>:bento-dev-db1.cehcqzecegos.us-west-2.rds.amazonaws.com:3306
    ```
    
    So for example  
    
    ```
    ssh -N marc@bento-dev-api1 -L 3306:bento-dev-db1.cehcqzecegos.us-west-2.rds.amazonaws.com:3306
    ```
    
    Then in `private.js`, configure Node to connect to the database at `localhost:3306`. Note that this is the default configuration and has already been done for you.

Once you have all the dependencies installed and set up, you can start Node with the following command

```
cd /home/marc/workspace/bento/nodejs
./node server.js <options>
```

with any of the following options

```
-e [local|dev]		The environment to start Node in. If not supplied, the default is local.
-p <server-port>	The server port to listen on. The default is 8081.
--server-id <uuid>	For testing. Node supports clustering so you can start multiple instances and they will all
					automatically coordinate with each other. By default, each Node instance in the cluster
					will be assigned a UUID but you can override this behavior by manually supplying your own
					ID. Do not assign two or more instances the same ID or weird things will happen!
--no-auth			For testing. A valid access token is required for most API calls to Node. If started with this
      				flag, any token is a valid token. For example, this will work where it would normally fail
      				http://localhost:8081/api/track?clientId=d-8&token=s-4-0-whatever. You must still supply a
      				well-formed token, however. See the Google docs for more information.
```
