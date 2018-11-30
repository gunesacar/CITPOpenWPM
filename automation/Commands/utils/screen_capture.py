from ...MPLogger import loggingclient
from ...Commands import browser_commands

from time import sleep, time
from datetime import datetime
from urlparse import urlparse


def capture_screenshots(visit_duration, **kwargs):
    """Capture screenshots every second."""
    driver = kwargs['driver']
    visit_id = kwargs['visit_id']
    manager_params = kwargs['manager_params']
    logger = loggingclient(*manager_params['logger_address'])
    for idx in xrange(0, visit_duration):
        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
        suffix = "%s_%s_%d" % (urlparse(driver.current_url).hostname,
                               timestamp,
                               idx)
        capture_duration = 0
        try:
            t0 = time()
            browser_commands.save_screenshot(visit_id, None, driver,
                                             manager_params, suffix)
            capture_duration = time() - t0
            logger.info("Save_screenshot took %0.1f on %s Visit ID: %d" %
                        (capture_duration, driver.current_url, visit_id))
        except Exception:
            logger.exception("Error while taking screenshot on %s Visit ID: %d"
                             % (driver.current_url, visit_id))

        sleep(max([0, 1-capture_duration]))
