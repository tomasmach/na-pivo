from django.db import migrations, models

import pubs.models


class Migration(migrations.Migration):
    dependencies = [("pubs", "0068_pubcommunitydata_historical_beers")]

    operations = [
        migrations.AddField(
            model_name="feedbackreport",
            name="attachment",
            field=models.ImageField(
                blank=True,
                default="",
                help_text="Optional support screenshot/photo, re-encoded to WebP with metadata stripped.",
                max_length=255,
                upload_to=pubs.models.feedback_attachment_path,
            ),
        ),
        migrations.AddField(
            model_name="feedbackreport",
            name="attachment_url",
            field=models.URLField(
                blank=True,
                default="",
                help_text="Absolute media URL captured at upload time for the Linear issue link.",
            ),
        ),
    ]
