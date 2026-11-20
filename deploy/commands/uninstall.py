"""`signal uninstall`: remove the service, its monitor and the command. The
database, backups, logs and settings stay unless --purge-data is given."""
from deploy.lib import paths as paths_lib
from deploy.lib import proc
from deploy.platforms import current as current_platform

CONFIRM_WORD = "DELETE"


def run(opts) -> int:
    plat = current_platform()
    paths, _ = paths_lib.current()
    plat.preflight(opts)
    if opts.purge_data and not opts.yes and not proc.DRY_RUN:
        print("This permanently deletes:")
        print(f"  {paths.db}  (all accounts, TOTP enrolments, watchlists, portfolios and "
              "every signal ever collected)")
        print(f"  {paths.backups}\n  {paths.logs}\n  {paths.settings}")
        if input(f"Type {CONFIRM_WORD} to confirm: ") != CONFIRM_WORD:
            proc.say("nothing was removed")
            return 1
    proc.say("service")
    plat.unregister(paths, opts.purge_data)
    if opts.purge_data:
        proc.say("data, logs and settings removed")
    else:
        proc.say(f"kept {paths.data} (database, backups) and {paths.settings}; "
                 "--purge-data removes them")
    return 0
