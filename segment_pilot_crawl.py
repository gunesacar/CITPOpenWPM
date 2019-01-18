from automation import TaskManager, CommandSequence
from automation.Errors import CommandExecutionError
import time
import os
from automation.Commands.utils.screen_capture import capture_screenshots
from urlparse import urlparse

DEBUG = False


# The list of sites that we wish to crawl
if DEBUG:
    NUM_BROWSERS = 1
else:
    NUM_BROWSERS = 7
NUM_BATCH = 5000
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

manager_params, browser_params = TaskManager.load_default_params(NUM_BROWSERS)
date_prefix = '2019-01-18'  # Updated by deployment script
if DEBUG:
    date_prefix = 'debug-' + date_prefix

prefix = date_prefix + '_segmentation_pilot'
manager_params['database_name'] = prefix + '.sqlite'
manager_params['data_directory'] = '~/' + prefix
manager_params['log_directory'] = '~/' + prefix
manager_params['testing'] = DEBUG
# Read the site list
sites = []

if DEBUG:
    sites = ['https://www.jcpenney.com/p/xersion-tunic-top/ppr5007814157?pTmplType=regular',
             #'https://www.aaghalalfoods.jp/product/green-chillies-200-g/'
             ]
else:
    for l in open("500-product-links.csv"):
        sites.append(l.rstrip())

TOTAL_NUM_SITES = len(sites)

for i in xrange(NUM_BROWSERS):
    browser_params[i]['headless'] = True
    if DEBUG:
        browser_params[i]['headless'] = False
    browser_params[i]['js_instrument'] = True
    browser_params[i]['cookie_instrument'] = True
    browser_params[i]['http_instrument'] = True

start_time = time.time()

# Manage control files
if not os.path.isdir(os.path.expanduser('~/.openwpm/')):
    os.mkdir(os.path.expanduser('~/.openwpm/'))
if os.path.isfile(os.path.expanduser('~/.openwpm/reboot')):
    os.remove(os.path.expanduser('~/.openwpm/reboot'))
if os.path.isfile(os.path.expanduser('~/.openwpm/current_site_index')):
    with open(os.path.expanduser('~/.openwpm/current_site_index'), 'r') as f:
        start_index = int(f.read()) + 1
    end_index = start_index + NUM_BATCH
else:
    start_index = 0
    end_index = NUM_BATCH + 1

manager = TaskManager.TaskManager(manager_params, browser_params,
                                  process_watchdog=True)
current_index = 0
for i in range(start_index, end_index):
    current_index = i
    if current_index >= TOTAL_NUM_SITES:
        break
    try:
        url = sites[i]
        cs = CommandSequence.CommandSequence(
            url, reset=True)
        TIME_ON_PAGE = 240  # product interaction = 125, initial wait 10
        # + time for click to addtocart,viewcart,checkout
        GET_TIMEOUT = TIME_ON_PAGE * 2  # must be longer than the TIME_ON_PAGE
        cs.get(sleep=1, timeout=GET_TIMEOUT)
        # cs.run_custom_function(close_dialogs, ())
        hostname = urlparse(url).hostname
        cs.dump_page_source(hostname, timeout=TIME_ON_PAGE+5)
        cs.run_custom_function(capture_screenshots, (TIME_ON_PAGE,),
                               timeout=TIME_ON_PAGE+5)
        manager.execute_command_sequence(cs)
        with open(
                os.path.expanduser('~/.openwpm/current_site_index'),
                'w') as f:
            f.write(str(i))
    except CommandExecutionError:
        with open(os.path.expanduser('~/.openwpm/reboot'), 'w') as f:
            f.write(str(1))
        break

print "CLOSING TaskManager after batch"
manager.close()

# Remove index file if we are done
if current_index >= TOTAL_NUM_SITES:
    os.remove(os.path.expanduser('~/.openwpm/current_site_index'))
    with open(os.path.expanduser('~/.openwpm/crawl_done'), 'w') as f:
        f.write(str(1))
print "Total time: " + str(time.time() - start_time)
