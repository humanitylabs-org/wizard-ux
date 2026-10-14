package ai.wizards.os;

import android.app.Application;

/** Loads this Wizard's address (device/WizardAddress) before any activity, service or receiver runs. */
public final class WizardApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        ai.wizards.os.device.WizardAddress.load(this);
        ai.wizards.os.device.OwnerProfile.load(this);
    }
}
