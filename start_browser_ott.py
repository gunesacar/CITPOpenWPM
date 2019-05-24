from __future__ import absolute_import
import sys

from automation import CommandSequence, TaskManager

NUM_BROWSERS = 1
if len(sys.argv) > 1:
    data_dir = sys.argv[1]
else:
    print("Pass data folder as the argument")
    sys.exit(1)


manager_params, browser_params = TaskManager.load_default_params(NUM_BROWSERS)
browser_params[0]['http_instrument'] = True
browser_params[0]['cookie_instrument'] = True
browser_params[0]['js_instrument'] = True
browser_params[0]['save_javascript'] = True

manager_params['data_directory'] = data_dir
manager_params['log_directory'] = data_dir

manager = TaskManager.TaskManager(manager_params, browser_params)
command_sequence = CommandSequence.CommandSequence("about:newtab")
command_sequence.start_manual_interaction()
manager.execute_command_sequence(command_sequence)
manager.close(block_on_commands=True)
