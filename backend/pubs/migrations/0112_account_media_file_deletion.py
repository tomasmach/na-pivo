from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("pubs", "0111_account_deletion_epoch"),
    ]

    operations = [
        migrations.AlterField(
            model_name="beerphotofiledeletion",
            name="client_id",
            field=models.UUIDField(
                blank=True,
                help_text="Client identity of the deleted beer photo; null for avatars.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="beerphotofiledeletion",
            name="file_kind",
            field=models.CharField(
                choices=[("beer_photo", "Beer photo"), ("avatar", "Avatar")],
                default="beer_photo",
                help_text="Selects the Django storage field used for physical cleanup.",
                max_length=16,
            ),
        ),
    ]
