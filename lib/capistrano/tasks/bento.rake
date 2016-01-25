# function_name("arg1") can be invoked as function_name "arg1"
# Capistrano API -
# desc() - From Rake library (forms foundation of Capistrano task system)
# task() - From Rake library 
# on()
# roles()
desc "Check that we can access everything"
task :check_write_permissions do
	# |host| - yield a variable to the block; return value of "on roles(:all)"
	on roles(:all) do |host|
		msg = "check: #{fetch(:deploy_to)} is writeable on #{host} - "
		# test(cmd, file1 [,file2])->obj - Built-in Ruby function
		# hashtag (#) - Ruby syntax; string interpolation
		# fetch(key [,default])->obj - Built-in Ruby function
		if test("[ -w #{fetch(:deploy_to)} ]")
			info msg + "yes"
		else
			error msg + "no"
		end
	end
end

desc "Check if agent forwarding is working"
task :forwarding do
	on roles(:all) do |host|
		msg = "check: Agent forwarding up to #{host} - "
		# ssh -A
		if test("env | grep SSH_AUTH_SOCK")
			info msg + "yes"
		else
			error msg + "no"
		end
	end
end

# file - relative (path) to :deploy_to
def symlink(src, file)
	if test("[ ! -f #{fetch(:deploy_to)}/#{file} ]")
		execute "ln -s #{src} #{fetch(:deploy_to)}/#{file}"
	end
end

def npm_install(module_name)
	if test("[ ! -d #{fetch(:deploy_to)}/shared/node_modules/#{module_name} ]")
		# Some modules require node to be on the path to build
		execute "export PATH=/opt/node/bin:$PATH && cd #{fetch(:deploy_to)}/shared && ./npm install #{module_name}"
	end
end

desc "Install node modules and set up symlinks"
task :setup_server do
	on roles(:all) do |host|
		# ":deploy_to/" automatically prepended to second argument!
		symlink("/opt/node/bin/node", "shared/node")
		symlink("/opt/node/bin/npm" , "shared/npm" )
		npm_install("socket.io")
		npm_install("redis")
		npm_install("express")
		npm_install("fs")
		npm_install("mysql")
		npm_install("bcrypt")
		npm_install("winston")
		npm_install("socket.io-redis");
		npm_install("uid2");
		npm_install("uuid");
		symlink("#{fetch(:deploy_to)}/shared/node", "current/node")
		symlink("#{fetch(:deploy_to)}/shared/node_modules", "current/node_modules")
		upload! "private.js", "#{fetch(:deploy_to)}/current", :via => :scp
		#upload! "config/shared/#{fetch(:stage)}/", "#{fetch(:deploy_to)}/shared", :via => :scp, :recursive => true
		# start server in a separate task
		#execute "cd #{fetch(:deploy_to)}/current && ./node server.js -e #{fetch(:stage)}"
	end
end

desc "Start the server"
task :start do
	on roles(:all) do |host|
		# huponexit is off in Capistrano shell so sub-processes will continue to run after exit (nohup not required)
		# Not sure why, but the brackets are required to start the server as a background process
		execute "cd #{fetch(:deploy_to)}/current && (nohup ./node server.js -e #{fetch(:stage)} >/dev/null 2>&1 &)"
	end
end

desc "Stop the server"
task :stop do
	on roles(:all) do |host|
		execute "ps -e | grep -oP '^\s*[0-9]+(?=\s.+\snode$)' | sed -e 's/\s\+//g' | xargs kill -9"
	end
end

desc "Restart the server"
task :restart_server do
	on roles(:all) do |host|
		invoke 'stop'
		invoke 'start'
	end
end
