package cr.marin.shellkeep

import android.app.Application

class ShellKeepApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        @Volatile
        lateinit var instance: ShellKeepApp
            private set
    }
}
