from __future__ import absolute_import

from automation import CommandSequence, TaskManager

NUM_BROWSERS = 1

manager_params, browser_params = TaskManager.load_default_params(NUM_BROWSERS)
browser_params[0]['http_instrument'] = True
browser_params[0]['cookie_instrument'] = True
browser_params[0]['js_instrument'] = True
browser_params[0]['save_javascript'] = True

manager_params['data_directory'] = '~/Desktop/OpenWPM/'
manager_params['log_directory'] = '~/Desktop/OpenWPM/'

manager = TaskManager.TaskManager(manager_params, browser_params)
command_sequence = CommandSequence.CommandSequence("about:newtab")
command_sequence.start_manual_interaction()
manager.execute_command_sequence(command_sequence)
manager.close(block_on_commands=True)
