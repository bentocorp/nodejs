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

desc "Start the node server"
task :start_server do
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
		symlink("#{fetch(:to_deploy)}/shared/node", "current/node")
		symlink("#{fetch(:to_deploy)}/shared/node_modules", "current/node_modules")
		execute "#{fetch(:to_deploy)}/current/node server.js -e #{fetch(:stage)}"
	end
end