# function_name("arg1") can be invoked as function_name "arg1"
# Capistrano API -
# desc() - From Rake library (forms foundation of Capistrano task system)
# task() - From Rake library 
# on()
# roles()
desc "Check that we can access everything"
task :check_write_permissions do
	# |host| - yield a variable to the block
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