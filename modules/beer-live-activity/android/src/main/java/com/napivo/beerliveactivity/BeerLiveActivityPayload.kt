package com.napivo.beerliveactivity

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

internal class BeerLiveActivityPayload : Record {
  @Field
  var sessionId: String = ""

  @Field
  var pubName: String = ""

  @Field
  var beerCount: Int = 0

  @Field
  var totalPrice: String = ""

  @Field
  var latestBeerName: String = ""
}
