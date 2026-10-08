"""旧版后台任务兼容入口：移除任务，不再常驻运行。"""

def main():
    # 兼容旧计划任务入口：新版本不再允许脱离桌面窗口执行福利检查。
    from music_runtime import configure_daily_task
    configure_daily_task(False)


if __name__ == '__main__':
    main()
