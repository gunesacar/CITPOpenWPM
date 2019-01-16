from os.path import join
from ...MPLogger import loggingclient

from time import sleep, time
from datetime import datetime
from urlparse import urlparse
import binascii
import base64


def save_screenshot_b64(out_png_path, image_b64, logger):
    try:
        with open(out_png_path, 'wb') as f:
            f.write(base64.b64decode(image_b64.encode('ascii')))
    except Exception:
        logger.exception("Error while saving screenshot to %s"
                         % (out_png_path))
        return False
    return True


def capture_screenshots(visit_duration, **kwargs):
    """Capture screenshots every second."""
    driver = kwargs['driver']
    visit_id = kwargs['visit_id']
    manager_params = kwargs['manager_params']
    logger = loggingclient(*manager_params['logger_address'])
    screenshot_dir = manager_params['screenshot_path']
    screenshot_base_path = join(screenshot_dir, "%d_%s" % (
        visit_id, urlparse(driver.current_url).hostname))
    last_image_crc = 0
    t_begin = time()
    for idx in xrange(0, visit_duration):
        t0 = time()
        quit_selenium = driver.execute_script("return window.quit_selenium;")
        phase = driver.execute_script("return localStorage['openwpm-phase'];")
        if quit_selenium:
            logger.info(
                "Received quit signal from selenium on %s Visit ID: %d phase: %s" %
                (driver.current_url, visit_id, phase))
            return

        try:
            img_b64 = driver.get_screenshot_as_base64()
        except Exception:
            logger.exception("Error while taking screenshot on %s Visit ID: %d"
                             % (driver.current_url, visit_id))
            sleep(max([0, 1-(time() - t0)]))  # try to spend 1s on each iteration
            continue
        new_image_crc = binascii.crc32(img_b64)
        # check if the image has changed
        if new_image_crc == last_image_crc:
            continue
        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
        out_png_path = "%s_%s_%d" % (screenshot_base_path,
                                     timestamp, idx)
        save_screenshot_b64(out_png_path, img_b64, logger)
        last_image_crc = new_image_crc
        capture_duration = time() - t0
        logger.info(
            "Save_screenshot took %0.1f on %s Visit ID: %d Loop: %d Phase: %s"
            % (capture_duration, driver.current_url, visit_id, idx, phase))

        sleep(max([0, 1-capture_duration]))
        if (time() - t_begin) > visit_duration:  # timeout
            break
